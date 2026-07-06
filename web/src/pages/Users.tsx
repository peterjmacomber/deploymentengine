import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type CreateUserInput, Permission, Role, type User, assignableRoles, canManageRole } from '@de/shared';
import { AppShell } from '../components/AppShell';
import { Badge } from '../components/ui';
import { DataTable } from '../components/DataTable';
import { useTableControls } from '../components/TableControls';
import { Modal } from '../components/Modal';
import { api, ApiError } from '../api/client';
import { useAuth } from '../stores/authStore';
import { useToast } from '../components/Toast';
import { dateTime, titleCase } from '../lib/format';

export function Users() {
  const can = useAuth((s) => s.can);
  const principal = useAuth((s) => s.principal);
  const qc = useQueryClient();
  const toast = useToast();
  const canWrite = can(Permission.USER_WRITE);
  const myRole = (principal?.role as Role) ?? Role.READONLY;
  const roleOptions = assignableRoles(myRole);
  const defaultRole = roleOptions.includes(Role.AGENT) ? Role.AGENT : (roleOptions[0] ?? Role.READONLY);

  const { data, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.users.list(),
  });

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);

  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<Role>(defaultRole);
  const [newPassword, setNewPassword] = useState('');

  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState<Role>(defaultRole);
  const [editActive, setEditActive] = useState(true);
  const [editPassword, setEditPassword] = useState('');

  const resetCreate = () => { setCreating(false); setNewEmail(''); setNewName(''); setNewRole(defaultRole); setNewPassword(''); };
  const openEdit = (u: User) => { setEditing(u); setEditName(u.name); setEditRole(u.role); setEditActive(u.active); setEditPassword(''); };

  const create = useMutation({
    mutationFn: () => api.users.create({ email: newEmail, name: newName, role: newRole as CreateUserInput['role'], password: newPassword }),
    onSuccess: () => { toast.push('User created', 'success'); qc.invalidateQueries({ queryKey: ['users'] }); resetCreate(); },
    onError: (e: unknown) => toast.push(e instanceof ApiError ? (e.detail ?? e.message) : 'Create failed', 'error'),
  });

  const update = useMutation({
    mutationFn: (id: number) => api.users.update(id, {
      name: editName,
      role: editRole,
      active: editActive,
      password: editPassword ? editPassword : undefined,
    }),
    onSuccess: () => { toast.push('User updated', 'success'); qc.invalidateQueries({ queryKey: ['users'] }); setEditing(null); },
    onError: (e: unknown) => toast.push(e instanceof ApiError ? (e.detail ?? e.message) : 'Update failed', 'error'),
  });

  // Role dropdown in edit must always include the user's current role (even if not assignable),
  // so it renders correctly; canManageRole gates whether Edit is offered at all.
  const editRoleOptions = editing && !roleOptions.includes(editing.role) ? [editing.role, ...roleOptions] : roleOptions;

  const { rows, toolbar } = useTableControls(data?.users ?? [], {
    search: (u) => `${u.name} ${u.email}`,
    searchPlaceholder: 'Search name or email…',
    facets: [
      { key: 'role', label: 'Role', value: (u) => titleCase(u.role) },
      { key: 'active', label: 'Status', value: (u) => (u.active ? 'Active' : 'Inactive') },
    ],
  });

  return (
    <AppShell
      title="Users"
      actions={canWrite && <button className="btn primary" onClick={() => setCreating(true)}>+ Add user</button>}
    >
      {toolbar}
      <DataTable
        keyOf={(u) => u.id}
        rows={rows}
        loading={isLoading}
        empty="No users match."
        columns={[
          { header: 'Name', sort: (u) => u.name.toLowerCase(), cell: (u) => u.name },
          { header: 'Email', sort: (u) => u.email.toLowerCase(), cell: (u) => <span className="mono">{u.email}</span> },
          { header: 'Role', sort: (u) => u.role, cell: (u) => <Badge tone="blue">{titleCase(u.role)}</Badge> },
          { header: 'Active', sort: (u) => (u.active ? 0 : 1), cell: (u) => <Badge tone={u.active ? 'green' : 'gray'}>{u.active ? 'Active' : 'Inactive'}</Badge> },
          { header: 'Last login', sort: (u) => u.lastLoginAt ?? '', cell: (u) => <span className="small">{dateTime(u.lastLoginAt)}</span> },
          ...(canWrite ? [{
            header: '',
            cell: (u: User) => (canManageRole(myRole, u.role)
              ? <button className="btn sm" onClick={() => openEdit(u)}>Edit</button>
              : <span className="small muted">—</span>),
          }] : []),
        ]}
      />

      {creating && (
        <Modal
          title="Add user"
          onClose={resetCreate}
          footer={
            <>
              <button className="btn" onClick={resetCreate}>Cancel</button>
              <button className="btn primary" disabled={create.isPending || !newEmail || !newName || newPassword.length < 10} onClick={() => create.mutate()}>
                {create.isPending ? 'Creating…' : 'Create user'}
              </button>
            </>
          }
        >
          <div className="field"><label>Email</label><input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} /></div>
          <div className="field"><label>Name</label><input value={newName} onChange={(e) => setNewName(e.target.value)} /></div>
          <div className="field">
            <label>Role</label>
            <select value={newRole} onChange={(e) => setNewRole(e.target.value as Role)}>
              {roleOptions.map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}
            </select>
            {myRole !== Role.ADMIN && <div className="small muted">You can only create users below your access level.</div>}
          </div>
          <div className="field"><label>Password</label><input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} /><div className="small muted">Minimum 10 characters.</div></div>
        </Modal>
      )}

      {editing && (
        <Modal
          title={`Edit ${editing.name}`}
          onClose={() => setEditing(null)}
          footer={
            <>
              <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn primary" disabled={update.isPending || !editName || (editPassword.length > 0 && editPassword.length < 10)} onClick={() => update.mutate(editing.id)}>
                {update.isPending ? 'Saving…' : 'Save changes'}
              </button>
            </>
          }
        >
          <div className="field"><label>Email</label><input value={editing.email} disabled /></div>
          <div className="field"><label>Name</label><input value={editName} onChange={(e) => setEditName(e.target.value)} /></div>
          <div className="field">
            <label>Role</label>
            <select value={editRole} onChange={(e) => setEditRole(e.target.value as Role)}>
              {editRoleOptions.map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}
            </select>
          </div>
          <label className="inline"><input type="checkbox" checked={editActive} onChange={(e) => setEditActive(e.target.checked)} /> Active</label>
          <div className="field" style={{ marginTop: 12 }}><label>New password</label><input type="password" value={editPassword} onChange={(e) => setEditPassword(e.target.value)} /><div className="small muted">Leave blank to keep current. Minimum 10 characters.</div></div>
        </Modal>
      )}
    </AppShell>
  );
}
