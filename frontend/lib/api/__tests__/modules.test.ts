import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as auth from '../auth';
import * as bills from '../bills';
import * as business from '../business';
import * as burn from '../burn';
import * as config from '../config';
import * as fiat from '../fiat';
import * as gateway from '../gateway';
import * as kyc from '../kyc';
import * as lending from '../lending';
import * as mint from '../mint';
import * as onramp from '../onramp';
import * as rates from '../rates';
import * as recipient from '../recipient';
import * as recovery from '../recovery';
import * as reserves from '../reserves';
import * as savings from '../savings';
import * as sme from '../sme';
import * as transactions from '../transactions';
import * as transfers from '../transfers';
import * as user from '../user';
import * as api from '../index';

const API_BASE = 'https://api.example.test/api/v1';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mockFetch(): ReturnType<typeof vi.fn> {
  return vi.mocked(fetch);
}

async function expectRequest(
  action: () => Promise<unknown>,
  expected: { method: string; path: string; body?: unknown },
): Promise<void> {
  const callCount = mockFetch().mock.calls.length;
  await action();
  expect(mockFetch()).toHaveBeenCalledTimes(callCount + 1);

  const [url, init] = mockFetch().mock.calls[callCount];
  expect(String(url)).toBe(`${API_BASE}${expected.path}`);
  expect(init?.method).toBe(expected.method);
  if ('body' in expected) {
    expect(JSON.parse(String(init?.body))).toEqual(expected.body);
  } else {
    expect(init?.body).toBeUndefined();
  }
}

describe('API module request shaping', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => jsonResponse({ ok: true })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shapes authentication requests and normalizes usernames', async () => {
    await expectRequest(() => auth.signup('  Alice  ', '1234'), {
      method: 'POST', path: '/auth/signup', body: { username: 'alice', passcode: '1234' },
    });
    await expectRequest(() => auth.signin('alice', '1234'), {
      method: 'POST', path: '/auth/signin', body: { identifier: 'alice', passcode: '1234' },
    });
    await expectRequest(() => auth.verify2fa('challenge/token', '987654'), {
      method: 'POST', path: '/auth/signin/verify-2fa',
      body: { challenge_token: 'challenge/token', code: '987654' },
    });
    await expectRequest(() => auth.signout(), { method: 'POST', path: '/auth/signout' });
  });

  it('shapes user profile, wallet, contact, and guardian requests', async () => {
    await expectRequest(() => user.getMe(), { method: 'GET', path: '/users/me' });
    await expectRequest(() => user.patchMe({ username: 'new-name' }), {
      method: 'PATCH', path: '/users/me', body: { username: 'new-name' },
    });
    await expectRequest(() => user.getBalance(), { method: 'GET', path: '/users/me/balance' });
    await expectRequest(() => user.getReceive(), { method: 'GET', path: '/users/me/receive' });
    await expectRequest(() => user.postWalletConfirm({ wallet_address: 'GABC' }), {
      method: 'POST', path: '/users/me/wallet/confirm', body: { wallet_address: 'GABC' },
    });
    await expectRequest(() => user.putWalletAddress('GABC'), {
      method: 'PUT', path: '/users/me/wallet', body: { stellar_address: 'GABC' },
    });
    await expectRequest(() => user.deleteWallet(), { method: 'DELETE', path: '/users/me/wallet' });
    await expectRequest(() => user.getContacts(), { method: 'GET', path: '/users/me/contacts' });
    await expectRequest(() => user.postContact({ alias: 'Alice', pay_uri: 'web+stellar:pay' }), {
      method: 'POST', path: '/users/me/contacts', body: { alias: 'Alice', pay_uri: 'web+stellar:pay' },
    });
    await expectRequest(() => user.deleteContact('a/b'), {
      method: 'DELETE', path: '/users/me/contacts/a%2Fb',
    });
    await expectRequest(() => user.getGuardians(), { method: 'GET', path: '/users/me/guardians' });
    await expectRequest(() => user.postGuardian({ user_id: 'guardian-1' }), {
      method: 'POST', path: '/users/me/guardians', body: { user_id: 'guardian-1' },
    });
    await expectRequest(() => user.deleteGuardian('guardian-1'), {
      method: 'DELETE', path: '/users/me/guardians/guardian-1',
    });
  });

  it('handles QR-code requests as JSON or binary payloads', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ url: 'https://qr.example.test/code' })));
    await expect(user.getReceiveQrcode()).resolves.toEqual({ url: 'https://qr.example.test/code' });
    expect(mockFetch().mock.calls[0][0]).toBe(`${API_BASE}/users/me/receive/qrcode`);

    const image = new Blob(['image-data'], { type: 'image/png' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(image, {
      headers: { 'content-type': 'image/png' },
    })));
    await expect(user.getReceiveQrcode()).resolves.toBeInstanceOf(Blob);
  });

  it('exposes the API modules and client methods from the public barrel', () => {
    expect(api.get).toBeTypeOf('function');
    expect(api.post).toBeTypeOf('function');
    expect(api.transfers.createTransfer).toBe(transfers.createTransfer);
    expect(api.savings.savingsDeposit).toBe(savings.savingsDeposit);
    expect(api.lending.lendingDeposit).toBe(lending.lendingDeposit);
  });

  it('shapes transfer and SME transfer requests, preserving transaction hashes', async () => {
    await expectRequest(() => transfers.getTransfers(), { method: 'GET', path: '/transfers' });
    await expectRequest(() => transfers.getTransfer('tx/1'), {
      method: 'GET', path: '/transfers/tx%2F1',
    });
    await expectRequest(() => transfers.createTransfer({
      to: 'GRECIPIENT', amount_acbu: '12.5000000', blockchain_tx_hash: 'stellar-hash',
    }), {
      method: 'POST', path: '/transfers',
      body: { to: 'GRECIPIENT', amount_acbu: '12.5000000', blockchain_tx_hash: 'stellar-hash' },
    });
    await expectRequest(() => sme.getSmeTransfers(), { method: 'GET', path: '/sme/transfers' });
    await expectRequest(() => sme.getSmeTransfer('id/1'), {
      method: 'GET', path: '/sme/transfers/id%2F1',
    });
    await expectRequest(() => sme.createSmeTransfer({ to: 'GRECIPIENT', amount_acbu: '3' }), {
      method: 'POST', path: '/sme/transfers', body: { to: 'GRECIPIENT', amount_acbu: '3' },
    });
    await expectRequest(() => sme.getSmeStatements(), { method: 'GET', path: '/sme/statements' });
  });

  it('shapes mint, burn, and on-ramp requests', async () => {
    await expectRequest(() => mint.mintFromUsdc('10.00', 'GDEST', 'auto'), {
      method: 'POST', path: '/mint/usdc',
      body: { usdc_amount: '10.00', wallet_address: 'GDEST', currency_preference: 'auto' },
    });
    await expectRequest(() => burn.burnAcbu('5', 'ngn', {
      type: 'bank', account_number: '1234', bank_code: '001', account_name: 'Alice',
    }, undefined, 'burn-hash'), {
      method: 'POST', path: '/burn/acbu',
      body: {
        acbu_amount: '5', currency: 'NGN',
        recipient_account: { type: 'bank', account_number: '1234', bank_code: '001', account_name: 'Alice' },
        blockchain_tx_hash: 'burn-hash',
      },
    });
    await expectRequest(() => onramp.registerOnRampSwap({ provider: 'test', swap_id: 'swap-1' }), {
      method: 'POST', path: '/onramp/register', body: { provider: 'test', swap_id: 'swap-1' },
    });
  });

  it('shapes savings and lending requests and encodes query parameters', async () => {
    await expectRequest(() => savings.getSavingsPositions('user & one', 60), {
      method: 'GET', path: '/savings/positions?user=user+%26+one&term_seconds=60',
    });
    await expectRequest(() => savings.savingsDeposit({ user: 'user-1', amount: '4', term_seconds: 60 }), {
      method: 'POST', path: '/savings/deposit',
      body: { user: 'user-1', amount: '4', term_seconds: 60 },
    });
    await expectRequest(() => savings.savingsWithdraw({ user: 'user-1', term_seconds: 60, amount: '2' }), {
      method: 'POST', path: '/savings/withdraw',
      body: { user: 'user-1', term_seconds: 60, amount: '2' },
    });
    await expectRequest(() => lending.getLendingBalance('LENDER & 1'), {
      method: 'GET', path: '/lending/balance?lender=LENDER%20%26%201',
    });
    await expectRequest(() => lending.lendingDeposit({ lender: 'lender-1', amount: '8' }), {
      method: 'POST', path: '/lending/deposit', body: { lender: 'lender-1', amount: '8' },
    });
    await expectRequest(() => lending.lendingWithdraw({ lender: 'lender-1', amount: '2' }), {
      method: 'POST', path: '/lending/withdraw', body: { lender: 'lender-1', amount: '2' },
    });
    await expectRequest(() => lending.applyForLoan({
      productId: 'loan-1', amount: 100, term: 12,
    }), {
      method: 'POST', path: '/lending/apply',
      body: { productId: 'loan-1', amount: 100, term: 12 },
    });
  });

  it('shapes fiat and faucet requests with numeric amount serialization', async () => {
    await expectRequest(() => fiat.getFiatAccounts(), { method: 'GET', path: '/fiat/accounts' });
    await expectRequest(() => fiat.postFaucet('NGN', '25.5', 'GRECIPIENT'), {
      method: 'POST', path: '/fiat/faucet', body: { currency: 'NGN', amount: 25.5, recipient: 'GRECIPIENT' },
    });
    await expectRequest(() => fiat.postFaucet('USD', '1', undefined), {
      method: 'POST', path: '/fiat/faucet', body: { currency: 'USD', amount: 1 },
    });
    await expectRequest(() => fiat.postOnRamp('15.25', 'EUR'), {
      method: 'POST', path: '/fiat/onramp', body: { amount: 15.25, currency: 'EUR' },
    });
    await expectRequest(() => fiat.postOffRamp('12', 'KES', 'stellar-hash'), {
      method: 'POST', path: '/fiat/offramp',
      body: { amount: 12, currency: 'KES', blockchain_tx_hash: 'stellar-hash' },
    });
  });

  it('shapes transaction, rate, reserve, and recipient lookups', async () => {
    await expectRequest(() => transactions.getTransaction('tx/1'), {
      method: 'GET', path: '/transactions/tx%2F1',
    });
    await expectRequest(() => transactions.listTransactions({ limit: 20, cursor: 'next/page' }), {
      method: 'GET', path: '/transactions?limit=20&cursor=next%2Fpage',
    });
    await expectRequest(() => transactions.listTransactions({ limit: 0, cursor: '' }), {
      method: 'GET', path: '/transactions?limit=0',
    });
    await expectRequest(() => rates.getRates(), { method: 'GET', path: '/rates' });
    await expectRequest(() => rates.getQuote('12.5', 'XOF'), {
      method: 'GET', path: '/rates/quote?amount=12.5&currency=XOF',
    });
    await expectRequest(() => reserves.getReserves(), { method: 'GET', path: '/reserves' });
    await expectRequest(() => recipient.resolveRecipient('alice+test@example.com'), {
      method: 'GET', path: '/recipient?q=alice%2Btest%40example.com',
    });
  });

  it('shapes KYC application, document, and validator requests', async () => {
    await expectRequest(() => kyc.getApplications(), { method: 'GET', path: '/kyc/applications' });
    await expectRequest(() => kyc.getApplication('app/1'), {
      method: 'GET', path: '/kyc/applications/app%2F1',
    });
    await expectRequest(() => kyc.createApplication({
      country_code: 'NG', fee_tx_hash: 'fee-hash',
      documents: [{ kind: 'id_front', storage_ref: 'doc/1', checksum: 'sha256' }],
    }), {
      method: 'POST', path: '/kyc/applications',
      body: {
        country_code: 'NG', fee_tx_hash: 'fee-hash',
        documents: [{ kind: 'id_front', storage_ref: 'doc/1', checksum: 'sha256' }],
      },
    });
    await expectRequest(() => kyc.getUploadUrl('app/1', 'id_front'), {
      method: 'GET', path: '/kyc/applications/upload-urls?applicationId=app%2F1&kind=id_front',
    });
    await expectRequest(() => kyc.patchApplicationDocuments('app/1', {
      documents: [{ kind: 'selfie', storage_ref: 'selfie-ref' }],
    }), {
      method: 'PATCH', path: '/kyc/applications/app%2F1/documents',
      body: { documents: [{ kind: 'selfie', storage_ref: 'selfie-ref' }] },
    });
    await expectRequest(() => kyc.postValidatorRegister(), {
      method: 'POST', path: '/kyc/validator/register', body: {},
    });
    await expectRequest(() => kyc.getValidatorTasks(), { method: 'GET', path: '/kyc/validator/tasks' });
    await expectRequest(() => kyc.postValidatorTaskResult('task/1', { approved: true }), {
      method: 'POST', path: '/kyc/validator/tasks/task%2F1', body: { approved: true },
    });
    await expectRequest(() => kyc.getValidatorMe(), { method: 'GET', path: '/kyc/validator/me' });
  });

  it('shapes recovery, bills, gateway, and business requests', async () => {
    await expectRequest(() => recovery.unlock({ recovery_code: 'secret', guardian_id: 'guardian-1' }), {
      method: 'POST', path: '/recovery/unlock',
      body: { recovery_code: 'secret', guardian_id: 'guardian-1' },
    });
    await expectRequest(() => bills.getBillsCatalog(), { method: 'GET', path: '/bills/catalog' });
    await expectRequest(() => bills.payBill({ biller_id: 'biller', amount: '5' }), {
      method: 'POST', path: '/bills/pay', body: { biller_id: 'biller', amount: '5' },
    });
    await expectRequest(() => gateway.createCharge({ amount_acbu: '3', currency: 'NGN' }), {
      method: 'POST', path: '/gateway/charges', body: { amount_acbu: '3', currency: 'NGN' },
    });
    await expectRequest(() => gateway.confirmCharge({ charge_id: 'charge-1', action: 'release' }), {
      method: 'POST', path: '/gateway/confirm', body: { charge_id: 'charge-1', action: 'release' },
    });
    await expectRequest(() => business.getBusinessStats(), { method: 'GET', path: '/business/stats' });
  });

  it('deduplicates concurrent config requests and caches successful responses', async () => {
    const configBody = {
      acbu: { code: 'ACBU', issuer: 'GISSUER' },
      demo_fiat: { issuer: null },
      stellar: { network_passphrase: 'Test SDF Network ; September 2015', horizon_url: null },
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(configBody)));
    config.clearAssetsConfigCache();

    const [first, second] = await Promise.all([
      config.getAssetsConfig(),
      config.getAssetsConfig(),
    ]);
    const third = await config.getAssetsConfig();

    expect(first).toEqual(configBody);
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(mockFetch()).toHaveBeenCalledOnce();
    expect(mockFetch().mock.calls[0][0]).toBe(`${API_BASE}/config/assets`);
  });
});
