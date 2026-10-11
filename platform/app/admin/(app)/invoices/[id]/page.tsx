import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InvoiceView } from "@/app/components/InvoiceView";
import { INVOICE_COLUMNS, type StoredInvoice } from "@/lib/invoice-view";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Invoice" };

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase } = await getSession();
  // RLS: staff with aal2
  const { data } = await supabase.from("invoices").select(INVOICE_COLUMNS).eq("id", id).maybeSingle();
  if (!data) notFound();
  return <InvoiceView inv={data as unknown as StoredInvoice} back={{ href: "/invoices", label: "Invoices" }} admin={true} />;
}
