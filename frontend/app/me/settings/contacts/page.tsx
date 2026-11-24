'use client';



import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { PageContainer } from '@/components/layout/page-container';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SkeletonList } from '@/components/ui/skeleton-list';
import { EmptyState } from '@/components/ui/empty-state';
import { ArrowLeft, UserPlus } from 'lucide-react';
import { useApiOpts } from '@/hooks/use-api';
import * as userApi from '@/lib/api/user';
import type { ContactItem } from '@/types/api';

export default function ContactsPage() {
  const opts = useApiOpts();
  const [contacts, setContacts] = useState<ContactItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [addAlias, setAddAlias] = useState('');
  const [addPayUri, setAddPayUri] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    setError('');
    userApi.getContacts(opts).then((data) => {
      setContacts(data.contacts ?? []);
    }).catch((e) => {
      setError(e instanceof Error ? e.message : 'Failed to load contacts');
    }).finally(() => setLoading(false));
  }, [opts.token]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addAlias.trim() && !addPayUri.trim()) return;
    setAdding(true);
    setError('');
    try {
      await userApi.postContact({ alias: addAlias.trim() || undefined, pay_uri: addPayUri.trim() || undefined }, opts);
      setAddAlias('');
      setAddPayUri('');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Add failed');
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await userApi.deleteContact(id, opts);
      setContacts((prev: ContactItem[]) => prev.filter((c: ContactItem) => c.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  if (loading) {
    return (
      <>
        <div className="page-header">
          <div className="page-header-row">
            <Link href="/me/settings"><ArrowLeft className="w-5 h-5 text-primary" /></Link>
            <h1 className="page-title">Contacts</h1>
          </div>
        </div>
        <PageContainer>
          <SkeletonList count={2} itemHeight="h-14" />
        </PageContainer>
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <div className="page-header-row">
          <Link href="/me/settings"><ArrowLeft className="w-5 h-5 text-primary" /></Link>
          <h1 className="page-title">Contacts</h1>
        </div>
      </div>
      <PageContainer>
        {error && <p className="text-destructive text-sm mb-3">{error}</p>}
        <form onSubmit={handleAdd} className="space-y-2 mb-6">
          <Input placeholder="Alias" value={addAlias} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAddAlias(e.target.value)} className="border-border" />
          <Input placeholder="Pay URI or address" value={addPayUri} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAddPayUri(e.target.value)} className="border-border" />
          <Button type="submit" disabled={adding || (!addAlias.trim() && !addPayUri.trim())}>Add contact</Button>
        </form>
        <div className="space-y-2">
          {contacts.length === 0 ? (
            <EmptyState
              icon={<UserPlus className="w-10 h-10" />}
              title="No contacts yet"
              description="Add your first contact above to quickly send money to friends and family."
            />
          ) : (
            contacts.map((c) => (
              <Card key={c.id} className="border-border p-4 flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground truncate" title={c.alias ?? c.pay_uri ?? c.id}>{c.alias ?? c.pay_uri ?? c.id}</p>
                  {c.alias && c.pay_uri && <p className="text-xs text-muted-foreground truncate" title={c.pay_uri}>{c.pay_uri}</p>}
                </div>
                <Button variant="outline" size="sm" className="border-destructive/30 text-destructive shrink-0" onClick={() => handleDelete(c.id)}>Remove</Button>
              </Card>
            ))
          )}
        </div>
      </PageContainer>
    </>
  );
}
