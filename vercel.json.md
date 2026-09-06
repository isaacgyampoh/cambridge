# Why the functions run in London

`vercel.json` pins serverless functions to `lhr1`.

Measured on 6 September 2026, before the change:

    Supabase database   eu-west-2  (London)
    Vercel functions    iad1       (Washington DC)

Every database query therefore crossed the Atlantic — roughly 80–90 ms of
round-trip latency PER QUERY, before any work was done. It compounds badly,
because a single page view makes several:

  * the proxy validates the session on every request (one query)
  * /api/auth/me re-reads the session
  * the page reads its own data

`/api/setup/status` issues three sequential queries and averaged **1.46 s**.

Pinning the functions to `lhr1` puts them beside the database. The user is in
Ghana, so neither region is local to them — but the client makes ONE round trip
to the function, while the function makes SEVERAL to the database. Colocating
the many short hops matters far more than the single long one.

If the database is ever moved, this must move with it.
