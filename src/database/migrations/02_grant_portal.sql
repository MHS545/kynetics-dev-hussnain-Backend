-- MANUAL ONLY. First register BOTH accounts in Kynetis.
-- Replace the two emails and choose compliance_officer or admin below.
-- Connect to kynetis_local as postgres and run the entire script in pgAdmin.
BEGIN;
DO $$
DECLARE
 staff_email text := 'replace-with-staff-email@example.com';
 customer_email text := 'replace-with-customer-email@example.com';
 staff_role text := 'compliance_officer';
 staff_id uuid; target_workspace uuid;
BEGIN
 IF staff_role NOT IN ('compliance_officer','admin') THEN RAISE EXCEPTION 'Invalid staff role'; END IF;
 SELECT id INTO staff_id FROM kynetis.users WHERE email=lower(trim(staff_email));
 SELECT m.workspace_id INTO target_workspace FROM kynetis.users u JOIN kynetis.memberships m ON m.user_id=u.id WHERE u.email=lower(trim(customer_email));
 IF staff_id IS NULL OR target_workspace IS NULL THEN RAISE EXCEPTION 'Register both users first and replace both email placeholders.'; END IF;
 INSERT INTO kynetis.portal_grants(user_id,workspace_id,role,label,reason)
 VALUES(staff_id,target_workspace,staff_role,CASE WHEN staff_role='admin' THEN 'Administration' ELSE 'Institution workspace' END,'Local operator approved access for this customer workspace')
 ON CONFLICT(user_id,workspace_id,role) DO UPDATE SET revoked_at=NULL,expires_at=NULL,reason=excluded.reason;
END $$;
COMMIT;
-- Refresh/sign in as the staff user. Choose the newly authorized portal.
