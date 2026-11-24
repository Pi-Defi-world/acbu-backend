import { get, post, patch } from './client';
import type { RequestOptions } from './client';
import type { KycApplication, KycApplicationsResponse } from '@/types/api';

export async function getApplications(opts?: RequestOptions): Promise<KycApplicationsResponse> {
  return get<KycApplicationsResponse>('/kyc/applications', opts);
}

export async function getApplication(id: string, opts?: RequestOptions): Promise<KycApplication> {
  return get<KycApplication>(`/kyc/applications/${encodeURIComponent(id)}`, opts);
}

export type KycDocumentKind = 'id_front' | 'id_back' | 'selfie';

export interface CreateKycApplicationBody {
  country_code: string;
  fee_tx_hash?: string;
  mint_transaction_id?: string;
  documents?: Array<{ kind: KycDocumentKind; storage_ref: string; checksum?: string; mime_type?: string }>;
}

export async function createApplication(body: CreateKycApplicationBody, opts?: RequestOptions): Promise<{ application_id: string; status: string }> {
  return post<{ application_id: string; status: string }>('/kyc/applications', body, opts);
}

export async function getUploadUrl(
  applicationId: string,
  kind: KycDocumentKind,
  opts?: RequestOptions
): Promise<{ upload_url: string; storage_ref: string }> {
  return get<{ upload_url: string; storage_ref: string }>(
    `/kyc/applications/upload-urls?applicationId=${encodeURIComponent(applicationId)}&kind=${encodeURIComponent(kind)}`,
    opts
  );
}

export interface KycDocumentInput {
  kind: KycDocumentKind;
  storage_ref: string;
  checksum?: string;
  mime_type?: string;
}

export async function patchApplicationDocuments(
  id: string,
  body: { documents: KycDocumentInput[] },
  opts?: RequestOptions
): Promise<unknown> {
  return patch(`/kyc/applications/${encodeURIComponent(id)}/documents`, body, opts);
}

// Validator
export async function postValidatorRegister(body?: Record<string, unknown>, opts?: RequestOptions): Promise<unknown> {
  return post('/kyc/validator/register', body ?? {}, opts);
}

export async function getValidatorTasks(opts?: RequestOptions): Promise<{ tasks?: unknown[] }> {
  return get<{ tasks?: unknown[] }>('/kyc/validator/tasks', opts);
}

export async function postValidatorTaskResult(
  taskId: string,
  body: Record<string, unknown>,
  opts?: RequestOptions
): Promise<unknown> {
  return post(`/kyc/validator/tasks/${encodeURIComponent(taskId)}`, body, opts);
}

export async function getValidatorMe(opts?: RequestOptions): Promise<unknown> {
  return get('/kyc/validator/me', opts);
}
