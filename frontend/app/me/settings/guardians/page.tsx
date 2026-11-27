'use client';



import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { PageContainer } from '@/components/layout/page-container';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SkeletonList } from '@/components/ui/skeleton-list';
import { EmptyState } from '@/components/ui/empty-state';
import { ArrowLeft, Shield } from 'lucide-react';
import { useApiOpts } from '@/hooks/use-api';
import * as userApi from '@/lib/api/user';
import type { GuardianItem } from '@/types/api';

export default function GuardiansPage() {
  const opts = useApiOpts();
  const [guardians, setGuardians] = useState<GuardianItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [addAddress, setAddAddress] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    setError('');
    userApi.getGuardians(opts).then((data) => {
      setGuardians(data.guardians ?? []);
    }).catch((e) => {
      setError(e instanceof Error ? e.message : 'Failed to load guardians');
    }).finally(() => setLoading(false));
  }, [opts.token]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addAddress.trim()) return;
    setAdding(true);
    setError('');
    try {
      await userApi.postGuardian({ address: addAddress.trim() }, opts);
      setAddAddress('');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Add failed');
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await userApi.deleteGuardian(id, opts);
      setGuardians((prev: GuardianItem[]) => prev.filter((g: GuardianItem) => g.id !== id));
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
            <h1 className="page-title">Guardians</h1>
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
          <h1 className="page-title">Guardians</h1>
        </div>
      </div>
      <PageContainer>
        {error && <p className="text-destructive text-sm mb-3">{error}</p>}
        <form onSubmit={handleAdd} className="space-y-2 mb-6">
          <Input placeholder="Guardian address" value={addAddress} onChange={(e) => setAddAddress(e.target.value)} className="border-border" />
          <Button type="submit" disabled={adding || !addAddress.trim()}>Add guardian</Button>
        </form>
        <div className="space-y-2">
          {guardians.length === 0 ? (
            <EmptyState
              icon={<Shield className="w-10 h-10" />}
              title="No guardians yet"
              description="Add trusted guardians who can help you recover your account if needed."
            />
          ) : (
            guardians.map((g) => (
              <Card key={g.id} className="border-border p-4 flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground truncate" title={g.id}>{g.id}</p>
                </div>
                <Button variant="outline" size="sm" className="border-destructive/30 text-destructive shrink-0" onClick={() => handleDelete(g.id)}>Remove</Button>
              </Card>
            ))
          )}
        </div>
      </PageContainer>
    </>
  );
}
