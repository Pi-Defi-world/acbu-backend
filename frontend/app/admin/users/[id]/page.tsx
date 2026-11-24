'use client';

import { useReducer } from 'react';
import { useParams } from 'next/navigation';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageContainer } from '@/components/layout/page-container';

// ---------------------------------------------------------------------------
// Types & reducer
// ---------------------------------------------------------------------------

type FormState = {
  name: string;
  email: string;
  role: string;
};

type Action =
  | { type: 'SET'; field: keyof FormState; value: string }
  | { type: 'RESET'; payload: FormState };

function formReducer(state: FormState, action: Action): FormState {
  switch (action.type) {
    case 'SET':
      return { ...state, [action.field]: action.value };
    case 'RESET':
      return action.payload;
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Placeholder data — replace with a real fetch keyed on `id`
// ---------------------------------------------------------------------------

const MOCK_USERS: Record<string, FormState> = {
  u1: { name: 'Alice Osei', email: 'alice@example.com', role: 'user' },
  u2: { name: 'Bob Mensah', email: 'bob@example.com', role: 'admin' },
  u3: { name: 'Carol Asante', email: 'carol@example.com', role: 'user' },
};

const DEFAULT_STATE: FormState = { name: '', email: '', role: 'user' };

// ---------------------------------------------------------------------------
// Inner form — receives initial values and owns its own useReducer state.
//
// The parent renders <UserEditForm key={id} …/> so React tears down and
// re-mounts this component whenever the user ID changes, guaranteeing the
// reducer initialises fresh from `initial` rather than carrying over stale
// state from the previous user's edit session.
// ---------------------------------------------------------------------------

function UserEditForm({ initial, userId }: { initial: FormState; userId: string }) {
  const [state, dispatch] = useReducer(formReducer, initial);

  const set = (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    dispatch({ type: 'SET', field, value: e.target.value });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // TODO: POST/PATCH to backend
    console.log('Saving user', userId, state);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="form-label" htmlFor="name">Full name</label>
        <input
          id="name"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          value={state.name}
          onChange={set('name')}
          required
        />
      </div>

      <div>
        <label className="form-label" htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          value={state.email}
          onChange={set('email')}
          required
        />
      </div>

      <div>
        <label className="form-label" htmlFor="role">Role</label>
        <select
          id="role"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          value={state.role}
          onChange={set('role')}
        >
          <option value="user">User</option>
          <option value="admin">Admin</option>
        </select>
      </div>

      <Button type="submit" className="w-full">Save changes</Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AdminUserEditPage() {
  const { id } = useParams<{ id: string }>();
  const initial = MOCK_USERS[id] ?? DEFAULT_STATE;

  return (
    <>
      <header className="page-header">
        <div className="mx-auto max-w-md page-header-row">
          <Link href="/admin/users" className="p-2 hover:bg-muted rounded transition-colors" aria-label="Back to users">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="page-title">Edit user</h1>
        </div>
      </header>

      <PageContainer>
        {/*
          key={id} is the fix: React unmounts and remounts UserEditForm
          whenever the user ID changes, so useReducer always initialises
          from the new user's data rather than retaining the previous one's.
        */}
        <UserEditForm key={id} initial={initial} userId={id} />
      </PageContainer>
    </>
  );
}
