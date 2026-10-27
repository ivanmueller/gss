# Supabase CA certificate

`supabase-root-2021-ca.crt` is Supabase's public root certificate ("Supabase Root 2021 CA",
valid to 2031-04-26), which signs the database and pooler certificates of hosted projects.
It is the file the Supabase dashboard offers under Database settings → SSL configuration,
also published at
`https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt`.
It is public, not a secret.

SHA-256 fingerprint:
`80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`

Cloudflare Hyperdrive uses it to verify the database it connects to
(`scripts/setup-hyperdrive.js`, docs/DECISIONS.md).
