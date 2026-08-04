-- Admin/user operations that remove rows (reset source identity, unused invites).
GRANT DELETE ON source_identities TO seqta_admin_api, seqta_cli;
GRANT DELETE ON invitations TO seqta_admin_api, seqta_user_api, seqta_cli;
