# Custody service architecture

The vault holds customer deposits. A release requires two of three committee signers.
Each signer is operated by a separate team, but independence of their cloud accounts
has not yet been established. No operator is intended to release deposits alone.

Customers authenticate through an external identity provider. The public API accepts
withdrawal requests and records an append-only audit event. A request must be approved
before the vault releases value. Idempotency keys prevent repeated processing.

The release service fetches approved requests from a queue and asks committee signers
for signatures. The vault verifies the threshold and recipient, then marks the request
consumed. Key custody, signature expiry and account recovery procedures are unspecified.

Maintainers deploy the release service using CI/CD. Production deployment is intended
to require a separate approver. The CI identity can update the service but must not
read signer keys. Cloud administrators can change runtime configuration.

Protected assets include deposits, signer keys, withdrawal authorization, audit records
and availability. Critical invariants include authorized releases only, no repeated
withdrawals, independent approval and preserved accountability.

Boundaries include customer-to-identity-provider, public-API-to-queue, queue-to-release-
service, release-service-to-signers, signers-to-vault and CI/CD-to-production.

This is a synthetic demonstration architecture, not a description of Dividend or any
other deployed system. Missing details should be retained as open assumptions.
