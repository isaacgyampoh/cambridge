-- Fee reminders: off.
--
-- Isaac asked for payment reminders to be turned off. They had been going out
-- daily and unattended to every student with an outstanding balance, through
-- the `payment_reminders` entry in the cron fan-out.
--
-- The code is already safe without this migration: a missing
-- payment_reminders_enabled row reads as OFF at every send site, which is the
-- deliberate polarity (see lib/payments/reminderPolicy.ts). This migration
-- writes the row anyway, so the state is explicit, visible in the Settings
-- toggle, and switched back on by a person rather than by a deleted row.

insert into settings (key, value)
values ('payment_reminders_enabled', 'false')
on conflict (key) do update set value = 'false';

-- To turn them back on, use the toggle in Admin → Settings, or:
--   update settings set value = 'true' where key = 'payment_reminders_enabled';
