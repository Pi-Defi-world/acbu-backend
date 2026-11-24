import Link from 'next/link';
import { Users } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { PageContainer } from '@/components/layout/page-container';

// Placeholder user list — replace with a real data-fetch when the backend is ready.
const MOCK_USERS = [
  { id: 'u1', name: 'Alice Osei', email: 'alice@example.com', role: 'user' },
  { id: 'u2', name: 'Bob Mensah', email: 'bob@example.com', role: 'admin' },
  { id: 'u3', name: 'Carol Asante', email: 'carol@example.com', role: 'user' },
];

export const metadata = {
  title: 'Users · Admin | ACBU',
};

export default function AdminUsersPage() {
  return (
    <>
      <header className="page-header">
        <div className="mx-auto max-w-md px-4 py-4 flex items-center gap-3">
          <Users className="w-5 h-5 text-muted-foreground" />
          <h1 className="page-title">Users</h1>
        </div>
      </header>

      <PageContainer>
        <div className="space-y-3">
          {MOCK_USERS.map((user) => (
            <Link key={user.id} href={`/admin/users/${user.id}`}>
              <Card className="border-border p-4 hover:bg-muted/40 transition-colors cursor-pointer">
                <p className="font-semibold text-foreground">{user.name}</p>
                <p className="text-xs text-muted-foreground">{user.email}</p>
              </Card>
            </Link>
          ))}
        </div>
      </PageContainer>
    </>
  );
}
