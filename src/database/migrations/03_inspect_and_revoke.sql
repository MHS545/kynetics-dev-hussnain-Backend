-- Read-only inspection:
SELECT id,email,active,created_at FROM kynetis.users ORDER BY created_at;
SELECT u.email,g.id AS grant_id,g.workspace_id,g.role,g.label,g.expires_at,g.revoked_at
FROM kynetis.portal_grants g JOIN kynetis.users u ON u.id=g.user_id;
SELECT workspace_id,revision,operation,actor,created_at FROM kynetis.events ORDER BY created_at DESC LIMIT 50;
-- To revoke a specific staff grant, substitute its ID and uncomment:
-- UPDATE kynetis.portal_grants SET revoked_at=now() WHERE id='replace-with-grant-uuid';
