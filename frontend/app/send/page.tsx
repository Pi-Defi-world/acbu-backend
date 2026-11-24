"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsTrigger, TabsList } from "@/components/ui/tabs";
import { SkeletonList } from "@/components/ui/skeleton-list";
import { Plus, Check, AlertCircle, ArrowRight } from "lucide-react";
import { useApiOpts } from "@/hooks/use-api";
import { useBalance } from "@/hooks/use-balance";
import { useAuth } from "@/contexts/auth-context";
import * as transfersApi from "@/lib/api/transfers";
import * as userApi from "@/lib/api/user";
import type { TransferItem, ContactItem } from "@/types/api";
import { formatAmount } from "@/lib/utils";
import { useDebounce } from "@/hooks/use-debounce";
import { getWalletSecretAnyLocal } from "@/lib/wallet-storage";
import { useStellarWalletsKit } from "@/lib/stellar-wallets-kit";
import { useConfig } from "@/hooks/use-config";
import { getTransferNetworkFeeText } from "@/lib/fee-text";
import {
  looksLikeStellarAddress,
  submitAcbuPaymentClient,
} from "@/lib/stellar/payments";
import { Keypair } from "@stellar/stellar-sdk";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function formatDate(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString();
}

function getStatusBadgeClassName(status: string): string {
  switch (status) {
    case "completed":
      return "border-green-600 text-green-600";
    case "pending":
      return "border-amber-600 text-amber-600";
    default:
      return "border-gray-600 text-gray-600";
  }
}

/**
 * Page component for sending ACBU tokens.
 */
export default function SendPage() {
  const opts = useApiOpts();
  const { config } = useConfig();
  const { userId, stellarAddress } = useAuth();
  const kit = useStellarWalletsKit();
  const {
    balance,
    loading: balanceLoading,
    refresh: refreshBalance,
  } = useBalance();
  const [activeTab, setActiveTab] = useState("send");
  const [showSendDialog, setShowSendDialog] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);
  const [selectedContact, setSelectedContact] = useState<ContactItem | null>(
    null,
  );
  const [amount, setAmount] = useState("");
  const debouncedAmount = useDebounce(amount, 300);
  const [confirmedAmount, setConfirmedAmount] = useState("");
  const [lastSentAmount, setLastSentAmount] = useState("");
  const [note, setNote] = useState("");
  const [customRecipient, setCustomRecipient] = useState("");
  const [useContact, setUseContact] = useState(true);
  const [transfers, setTransfers] = useState<TransferItem[]>([]);
  const [contacts, setContacts] = useState<ContactItem[]>([]);
  const [loadingTransfers, setLoadingTransfers] = useState(true);
  const [, setLoadingContacts] = useState(true);
  const [submitError, setSubmitError] = useState("");
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState("");
  const transferNetworkFeeText = getTransferNetworkFeeText(config);

  const virtualizedContacts = useMemo(() => {
    return contacts.map((c) => (
      <SelectItem key={c.id} value={c.id}>
        {c.alias ?? c.pay_uri ?? c.id}
      </SelectItem>
    ));
  }, [contacts]);

  const loadTransfers = useCallback(async () => {
    setLoadError("");
    transfersApi
      .getTransfers(opts)
      .then((data) => {
        setTransfers(data.transfers ?? []);
        setLoadError("");
      })
      .catch((e) =>
        setLoadError(
          e instanceof Error ? e.message : "Failed to load transfers",
        ),
      )
      .finally(() => setLoadingTransfers(false));
  }, [opts]);

  const loadContacts = useCallback(() => {
    setLoadError("");
    userApi
      .getContacts(opts)
      .then((data) => {
        setContacts(data.contacts ?? []);
        setLoadError("");
      })
      .catch((e) =>
        setLoadError(
          e instanceof Error ? e.message : "Failed to load contacts",
        ),
      )
      .finally(() => setLoadingContacts(false));
  }, [opts]);

  useEffect(() => {
    loadTransfers();
    loadContacts();
  }, [loadTransfers, loadContacts, opts.token]);

  const handleShowSendDialog = useCallback(() => setShowSendDialog(true), []);
  const handleSendDialogChange = useCallback(
    (open: boolean) => setShowSendDialog(open),
    [],
  );
  const handleConfirmDialogChange = useCallback(
    (open: boolean) => {
      setShowConfirmDialog(open);
    },
    [sending],
  );
  const handleSuccessDialogChange = useCallback(
    (open: boolean) => setShowSuccessDialog(open),
    [],
  );
  const handleTabChange = useCallback(
    (value: string) => setActiveTab(value),
    [],
  );
  const handleUseContactChange = useCallback(
    (v: string) => setUseContact(v === "contact"),
    [],
  );
  const handleContactSelect = useCallback(
    (id: string) => {
      const c = contacts.find((x: ContactItem) => x.id === id);
      if (c) setSelectedContact(c);
    },
    [contacts],
  );
  const handleCustomRecipientChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setCustomRecipient(e.target.value),
    [],
  );
  const handleAmountChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value;
      if (v === "" || /^\d*\.?\d*$/.test(v)) {
        setAmount(v);
      }
    },
    [],
  );
  const debouncedAmount = useDebounce(amount, 300);
  const handleNoteChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => setNote(e.target.value),
    [],
  );
  const handleSendDialogClose = useCallback(() => setShowSendDialog(false), []);
  const handleShowConfirmDialog = useCallback(() => {
    setShowConfirmDialog(true);
  }, []);

  const getToValue = useCallback(
    () =>
      useContact && selectedContact
        ? selectedContact.pay_uri || selectedContact.alias || selectedContact.id
        : customRecipient.trim(),
    [useContact, selectedContact, customRecipient],
  );

  const handleSendDialogChange = useCallback((open: boolean) => {
    setShowSendDialog(open);
  }, []);

  const handleContactSelect = useCallback((contactId: string) => {
    setSelectedContact(contacts.find((contact) => contact.id === contactId) ?? null);
  }, [contacts]);

  const handleCustomRecipientChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setCustomRecipient(event.target.value);
  }, []);

  const handleAmountChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setAmount(event.target.value);
  }, []);

  const handleNoteChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setNote(event.target.value);
  }, []);

  const handleConfirmDialogChange = useCallback((open: boolean) => {
    setShowConfirmDialog(open);
  }, []);

  const handleSuccessDialogChange = useCallback((open: boolean) => {
    setShowSuccessDialog(open);
  }, []);

  const handleConfirmTransfer = useCallback(async () => {
    const to = getToValue();
    if (!amount || parseFloat(amount) <= 0 || !to) {
      setSubmitError("Enter a valid amount greater than zero.");
      return;
    }
    setSubmitError("");
    setSending(true);
    try {
      let blockchainTxHash: string | undefined;

      // Client-signed path for direct Stellar addresses.
      if (looksLikeStellarAddress(to)) {
        if (!userId) throw new Error("Not logged in");
        const secret = await getWalletSecretAnyLocal(userId, stellarAddress);
        if (secret) {
          const sourceAddress = Keypair.fromSecret(secret).publicKey();
          if (stellarAddress && sourceAddress !== stellarAddress) {
            throw new Error(
              `Local wallet (${sourceAddress.slice(0, 6)}…${sourceAddress.slice(-4)}) doesn't match the account on record (${stellarAddress.slice(0, 6)}…${stellarAddress.slice(-4)}). Re-import the correct seed from Settings, or update the wallet address, then retry.`,
            );
          }
          const submit = await submitAcbuPaymentClient({
            destination: to,
            amount,
            userSecret: secret,
          });
          blockchainTxHash = submit.transactionHash;
        } else {
          if (!kit) {
            throw new Error(
              "Your wallet secret isn't available on this device and the wallet connector isn't ready yet. Please wait a moment and retry.",
            );
          }
          const address = await new Promise<string>((resolve, reject) => {
            kit
              .openModal({
                onWalletSelected: async (selectedOption: { id: string }) => {
                  try {
                    kit.setWallet(selectedOption.id);
                    const { address } = await kit.getAddress();
                    resolve(address);
                  } catch (err) {
                    reject(err);
                  }
                },
              })
              .catch(reject);
          });
          if (stellarAddress && address !== stellarAddress) {
            throw new Error(
              `Connected wallet (${address.slice(0, 6)}…${address.slice(-4)}) doesn't match the account on record (${stellarAddress.slice(0, 6)}…${stellarAddress.slice(-4)}). Connect the correct wallet (or update your linked wallet), then retry.`,
            );
          }
          const submit = await submitAcbuPaymentClient({
            destination: to,
            amount,
            external: { kit, address },
          });
          blockchainTxHash = submit.transactionHash;
        }
      }

      await transfersApi.createTransfer(
        {
          to,
          amount_acbu: amount,
          note,
          ...(blockchainTxHash ? { blockchain_tx_hash: blockchainTxHash } : {}),
        },
        opts,
      );
      loadTransfers();
      refreshBalance();
      setShowConfirmDialog(false);
      setShowSendDialog(false);
      setLastSentAmount(amount);
      setShowSuccessDialog(true);
      setTimeout(() => {
        setShowSuccessDialog(false);
        setAmount("");
        setNote("");
        setCustomRecipient("");
        setSelectedContact(null);
      }, 2500);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Transfer failed");
    } finally {
      setSending(false);
    }
  }, [
    amount,
    getToValue,
    note,
    userId,
    stellarAddress,
    kit,
    opts,
    loadTransfers,
    refreshBalance,
  ]);

  const exceedsBalance =
    balance !== null &&
    debouncedAmount !== "" &&
    parseFloat(debouncedAmount) > balance;

  const isFormValid = useMemo(() => {
    return (
      debouncedAmount &&
      parseFloat(debouncedAmount) > 0 &&
      !exceedsBalance &&
      ((useContact && selectedContact) ||
        (!useContact && customRecipient.trim()))
    );
  }, [
    debouncedAmount,
    exceedsBalance,
    useContact,
    selectedContact,
    customRecipient,
  ]);

  return (
    <>
      <Tabs
        value={activeTab}
        onValueChange={handleTabChange}
        className="w-full"
      >
        <header className="border-border bg-card/95 sticky top-0 z-10 border-b backdrop-blur-sm">
          <div className="px-4 py-3">
            <h1 className="text-foreground mb-3 text-lg font-bold">
              Send Money
            </h1>
            <TabsList aria-label="Send money options">
              <TabsTrigger value="send">
                Send
              </TabsTrigger>
              <TabsTrigger value="history">
                History
              </TabsTrigger>
            </TabsList>
          </div>
        </header>

        <div className="px-4 py-4">
          {loadError && (
            <div
              className="border-destructive/20 bg-destructive/5 text-destructive animate-in fade-in slide-in-from-top-2 mb-6 flex items-center gap-2 rounded-xl border p-4 text-sm duration-300"
              role="alert"
              aria-live="assertive"
            >
              <AlertCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
              <p className="font-medium">{loadError}</p>
            </div>
          )}

          <TabsContent value="send" className="mt-0 space-y-4 outline-none">
            <div className="grid grid-cols-2 gap-3">
              <Button
                onClick={handleShowSendDialog}
                className="bg-primary text-primary-foreground hover:bg-primary/90 h-auto flex-col py-4"
              >
                <Plus className="mb-2 h-5 w-5" />
                <span>New Transfer</span>
              </Button>
              <Button
                asChild
                variant="outline"
                className="border-border hover:bg-muted h-auto w-full flex-col bg-transparent py-4"
              >
                <Link href="/me/settings/contacts">
                  <Plus className="mb-2 h-5 w-5" />
                  <span>Add Contact</span>
                </Link>
              </Button>
            </div>
          </TabsContent>

          <TabsContent
            value="history"
            className="space-y-3"
          >
            <div>
              <h3 className="text-foreground mb-3 text-sm font-semibold">
                Recent Transfers
              </h3>
              {loadingTransfers ? (
                <SkeletonList count={2} itemHeight="h-14" />
              ) : transfers.length === 0 ? (
                <div className="border-border bg-card rounded-lg border p-6 text-center">
                  <p className="text-muted-foreground text-sm">
                    No transfers yet
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {transfers.map((t: TransferItem) => (
                    <Link
                      key={t.transaction_id}
                      href={`/send/${t.transaction_id}`}
                      className="border-border bg-card active:bg-muted focus:ring-primary flex items-center justify-between rounded-lg border p-4 transition-colors focus:ring-2 focus:ring-offset-2 focus:outline-none"
                      aria-label={`Transfer of ${t.amount_acbu} ACBU, status ${t.status}, created ${formatDate(t.created_at)}`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-foreground truncate font-medium">
                          Transfer
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {formatDate(t.created_at)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-foreground font-semibold">
                          ACBU {formatAmount(t.amount_acbu)}
                        </p>
                        <Badge
                          variant="outline"
                          className={`mt-1 text-xs ${getStatusBadgeClassName(t.status)}`}
                        >
                          {t.status === "completed" && (
                            <Check
                              className="mr-1 h-3 w-3"
                              aria-hidden="true"
                            />
                          )}
                          {t.status === "pending" && (
                            <AlertCircle
                              className="mr-1 h-3 w-3"
                              aria-hidden="true"
                            />
                          )}
                          {t.status.charAt(0).toUpperCase() + t.status.slice(1)}
                        </Badge>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>
        </div>
      </Tabs>

      {/* Send Dialog */}
      <Dialog open={showSendDialog} onOpenChange={handleSendDialogChange}>
        <DialogContent className="border-border max-w-md">
          <DialogHeader>
            <DialogTitle id="send-dialog-title">Send Money</DialogTitle>
            <DialogDescription id="send-dialog-description">
              Transfer ACBU securely to another wallet
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="recipient-type" className="text-foreground">
                Recipient
              </Label>
              <Tabs
                value={useContact ? "contact" : "custom"}
                onValueChange={handleUseContactChange}
              >
                <TabsList className="bg-muted grid w-full grid-cols-2">
                  <TabsTrigger value="contact">From Contacts</TabsTrigger>
                  <TabsTrigger value="custom">New Address</TabsTrigger>
                </TabsList>
                <TabsContent value="contact" className="mt-3">
                  <Select
                    value={selectedContact?.id || ""}
                    onValueChange={handleContactSelect}
                  >
                    <SelectTrigger
                      className="border-border"
                      id="contact-select"
                      aria-label="Select a contact"
                    >
                      <SelectValue placeholder="Select a contact" />
                    </SelectTrigger>
                    <SelectContent>
                      {loadingContacts ? (
                        <SelectItem value="__loading" disabled>
                          Loading contacts...
                        </SelectItem>
                      ) : contacts.length > 0 ? (
                        virtualizedContacts
                      ) : (
                        <SelectItem value="__empty" disabled>
                          No contacts found
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </TabsContent>
                <TabsContent value="custom">
                  <Input
                    id="custom-recipient"
                    name="custom-recipient"
                    placeholder="Wallet address or email"
                    value={customRecipient}
                    onChange={handleCustomRecipientChange}
                    className="border-border"
                    aria-describedby="recipient-hint"
                  />
                  <p
                    id="recipient-hint"
                    className="text-muted-foreground mt-1 text-xs"
                  >
                    Enter a Stellar address or email address
                  </p>
                </TabsContent>
              </Tabs>
            </div>

            <div className="space-y-2">
              <Label htmlFor="amount-input" className="text-foreground">
                Amount
              </Label>
              <div className="flex gap-2">
                <span className="text-muted-foreground flex items-center font-medium">
                  ACBU
                </span>
                <Input
                  id="amount-input"
                  name="amount"
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={amount}
                  onChange={handleAmountChange}
                  className="border-border text-lg font-semibold"
                  aria-describedby={
                    exceedsBalance ? "amount-error amount-hint" : "amount-hint"
                  }
                  aria-invalid={exceedsBalance}
                />
              </div>
              {exceedsBalance && (
                <p
                  id="amount-error"
                  className="text-destructive text-xs"
                  role="alert"
                >
                  Insufficient balance.
                </p>
              )}
              <p id="amount-hint" className="text-muted-foreground text-xs">
                Available: ACBU {balanceLoading ? "..." : formatAmount(balance)}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="note-input" className="text-foreground">
                Note (Optional)
              </Label>
              <Input
                id="note-input"
                name="note"
                placeholder="Add a message..."
                value={note}
                onChange={handleNoteChange}
                className="border-border"
                aria-describedby="note-hint"
              />
              <p id="note-hint" className="text-muted-foreground text-xs">
                Add an optional note to this transfer
              </p>
            </div>

            <Card className="border-border bg-muted p-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Network Fee</span>
                <span className="text-foreground font-medium">
                  {transferNetworkFeeText}
                </span>
              </div>
            </Card>

            <div className="flex gap-3 pt-2">
              <Button
                variant="outline"
                onClick={handleSendDialogClose}
                className="border-border flex-1"
                aria-label="Cancel transfer"
              >
                Cancel
              </Button>
              <Button
                onClick={handleShowConfirmDialog}
                disabled={!isFormValid}
                className="bg-primary text-primary-foreground hover:bg-primary/90 flex-1"
                aria-label="Continue to confirmation"
              >
                Continue
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={showConfirmDialog}
        onOpenChange={handleConfirmDialogChange}
      >
        <AlertDialogContent className="border-border max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle id="confirm-dialog-title">
              Confirm Transfer
            </AlertDialogTitle>
            <AlertDialogDescription id="confirm-dialog-description">
              Review the details before confirming
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 py-4">
            {submitError && (
              <p className="text-destructive text-sm" role="alert">
                {submitError}
              </p>
            )}
            <div className="border-border bg-muted rounded-lg border p-4">
              <p className="text-muted-foreground text-xs">To</p>
              <p className="text-foreground truncate font-semibold">
                {selectedContact?.alias ||
                  selectedContact?.pay_uri ||
                  customRecipient ||
                  "—"}
              </p>
            </div>
            <div className="flex items-center justify-center">
              <div className="bg-secondary rounded-full p-2">
                <ArrowRight
                  className="text-secondary-foreground h-5 w-5"
                  aria-hidden="true"
                />
              </div>
            </div>
            <div className="border-border bg-muted rounded-lg border p-4">
              <p className="text-muted-foreground text-xs">Amount</p>
              <p className="text-foreground text-2xl font-bold">
                ACBU {formatAmount(amount)}
              </p>
              <p className="text-muted-foreground mt-2 text-xs">
                Network Fee: {transferNetworkFeeText}
              </p>
            </div>
            {note && (
              <div className="border-border bg-muted rounded-lg border p-4">
                <p className="text-muted-foreground text-xs">Note</p>
                <p className="text-foreground text-sm break-words">{note}</p>
              </div>
            )}
          </div>
          <div className="flex gap-3">
            <AlertDialogCancel
              className="border-border flex-1"
              disabled={sending}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmTransfer}
              className="bg-primary text-primary-foreground hover:bg-primary/90 flex-1"
              disabled={sending || !amount}
            >
              {sending ? "Sending..." : `Send ACBU ${amount}`}
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={showSuccessDialog} onOpenChange={handleSuccessDialogChange}>
        <DialogContent className="border-border max-w-md">
          <div className="flex flex-col items-center py-6 text-center">
            <div className="mb-4 rounded-full bg-green-100 p-4 dark:bg-green-900">
              <Check
                className="h-8 w-8 text-green-600 dark:text-green-300"
                aria-hidden="true"
              />
            </div>
            <h2 className="text-foreground mb-2 text-xl font-bold">
              Transfer Sent!
            </h2>
            <p className="text-muted-foreground mb-4">
              Your transfer for ACBU {formatAmount(lastSentAmount)} is being
              processed.
            </p>
            <Badge
              variant="outline"
              className={`mb-4 ${getStatusBadgeClassName("pending")}`}
            >
              Pending
            </Badge>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
