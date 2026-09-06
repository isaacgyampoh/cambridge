-- ============================================================================
-- 0013 — FEE PAYMENTS: IDEMPOTENCY, ATOMIC BALANCES, REAL RECEIPT NUMBERS
--
-- Run AFTER 0012. Additive: one index, two functions, one sequence.
--
-- WHY
--
-- /api/fees/pay is a PUBLIC, unauthenticated endpoint. It accepted
-- `method: "momo"` from the request body and, on that word alone, marked the
-- payment verified, reduced the student's balance and sent them a receipt.
-- No Paystack check ran. Anyone holding a fee id — which the route's own
-- public GET hands out — could clear any student's fees by posting JSON.
--
-- The route also computed the new balance in application code:
--
--     newPaid = Number(fee.amount_paid) + amount
--
-- read first, written second. Two payments landing together both read the same
-- starting figure and the second overwrites the first.
--
-- 0004 already built the machinery to prevent all of this — claim_event,
-- record_payment_once, apply_fee_payment — for the Paystack webhook. This
-- route simply never used any of it. What is added here is the small amount
-- that was missing for the direct path.
--
-- Checked before writing: fee_payments holds 2 rows, both cash, and no momo
-- row has ever existed. The hole was never exploited.
-- ============================================================================

BEGIN;

/*
 * One credit per Paystack transaction.
 *
 * The last line of defence. Even if verification is bypassed or a request is
 * replayed, the same reference cannot be banked twice — a prior SELECT could
 * not guarantee that, because two requests can both read "not recorded"
 * before either writes.
 *
 * Partial, because cash and bank payments have no reference and must stay
 * free to repeat.
 */
CREATE UNIQUE INDEX IF NOT EXISTS idx_fee_payments_paystack_ref
  ON fee_payments(paystack_ref)
  WHERE paystack_ref IS NOT NULL;

/*
 * Atomic fee increment, addressed by the fee row itself.
 *
 * apply_fee_payment (0004) keys on lead_id, which the webhook always has.
 * A student paying from the apply flow may have no lead attached yet, so the
 * direct path needs the same arithmetic addressed by the fee id. The point is
 * identical: the addition happens inside the UPDATE, so two concurrent
 * payments cannot both read the same starting figure.
 */
CREATE OR REPLACE FUNCTION apply_fee_payment_by_id(p_fee UUID, p_amount NUMERIC)
RETURNS TABLE(total_fee NUMERIC, amount_paid NUMERIC, balance NUMERIC, status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  UPDATE student_fees
     SET amount_paid = COALESCE(student_fees.amount_paid, 0) + p_amount,
         balance     = GREATEST(0, COALESCE(student_fees.total_fee, 0)
                                 - (COALESCE(student_fees.amount_paid, 0) + p_amount)),
         status      = CASE
                         WHEN GREATEST(0, COALESCE(student_fees.total_fee, 0)
                              - (COALESCE(student_fees.amount_paid, 0) + p_amount)) <= 0
                         THEN 'paid' ELSE 'partial'
                       END,
         updated_at  = NOW()
   WHERE student_fees.id = p_fee
  RETURNING student_fees.total_fee, student_fees.amount_paid,
            student_fees.balance, student_fees.status;
END;
$$;

REVOKE ALL ON FUNCTION apply_fee_payment_by_id(UUID, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION apply_fee_payment_by_id(UUID, NUMERIC) TO service_role;

/*
 * Receipt numbers that cannot collide.
 *
 * They were built as CCE/RCT/<year>/<5 random digits>. With no uniqueness
 * anywhere, two students can hold the same receipt number — and by the
 * birthday bound that becomes likely long before the ninety-thousandth
 * receipt, not at it. A receipt is a financial reference; it has to be
 * unique or it is not a reference at all.
 */
CREATE SEQUENCE IF NOT EXISTS receipt_number_seq START 1;

CREATE OR REPLACE FUNCTION next_receipt_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN 'CCE/RCT/' || to_char(NOW(), 'YYYY') || '/'
         || lpad(nextval('receipt_number_seq')::TEXT, 5, '0');
END;
$$;

REVOKE ALL ON FUNCTION next_receipt_number() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION next_receipt_number() TO service_role;

-- Start the sequence past anything already issued, so a new receipt can never
-- reuse a number a student is already holding.
SELECT setval('receipt_number_seq',
  GREATEST(1, COALESCE((SELECT MAX(NULLIF(regexp_replace(receipt_no, '^.*/', ''), '')::BIGINT)
                          FROM fee_payments
                         WHERE receipt_no ~ '/[0-9]+$'), 0) + 1));

CREATE UNIQUE INDEX IF NOT EXISTS idx_fee_payments_receipt_no
  ON fee_payments(receipt_no)
  WHERE receipt_no IS NOT NULL;

COMMIT;
