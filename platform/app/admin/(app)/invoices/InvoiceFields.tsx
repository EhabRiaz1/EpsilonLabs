/** The editable invoice fields, shared by "new" and "edit draft" (server-rendered inputs inside an ActionForm). */
export type InvoiceFieldValues = { bill_company: string; bill_contact: string; project_label: string; lines: string; tax_label: string; tax_rate: string; currency: string; due_date: string };

export function InvoiceFields({ v, idp = "inv" }: { v: InvoiceFieldValues; idp?: string }) {
  return (
    <>
      <div className="row wrap" style={{ gap: 10 }}>
        <div className="field grow" style={{ minWidth: 180 }}><label className="label" htmlFor={`${idp}-bill`}>Bill to (company)</label><input className="input" id={`${idp}-bill`} name="bill_company" required maxLength={200} defaultValue={v.bill_company} /></div>
        <div className="field grow" style={{ minWidth: 160 }}><label className="label" htmlFor={`${idp}-contact`}>Contact</label><input className="input" id={`${idp}-contact`} name="bill_contact" maxLength={200} defaultValue={v.bill_contact} /></div>
      </div>
      <div className="field"><label className="label" htmlFor={`${idp}-project`}>Project label</label><input className="input" id={`${idp}-project`} name="project_label" maxLength={200} defaultValue={v.project_label} /></div>
      <div className="field">
        <label className="label" htmlFor={`${idp}-lines`}>Lines <span className="c-3">(one per row: Title | description | amount)</span></label>
        <textarea className="textarea mono-ish" id={`${idp}-lines`} name="lines" rows={5} required defaultValue={v.lines} placeholder={"Milestone 2 · dashboards live | 40% of the agreed total | 4000.00\nHosting October | 33.33"} />
      </div>
      <div className="row wrap" style={{ gap: 10 }}>
        <div className="field" style={{ width: 110 }}><label className="label" htmlFor={`${idp}-cur`}>Currency</label><input className="input" id={`${idp}-cur`} name="currency" required maxLength={3} pattern="[A-Za-z]{3}" defaultValue={v.currency} /></div>
        <div className="field grow" style={{ minWidth: 140 }}><label className="label" htmlFor={`${idp}-taxl`}>Tax label <span className="c-3">(optional)</span></label><input className="input" id={`${idp}-taxl`} name="tax_label" maxLength={40} defaultValue={v.tax_label} placeholder="Sales tax" /></div>
        <div className="field" style={{ width: 110 }}><label className="label" htmlFor={`${idp}-taxr`}>Tax %</label><input className="input" id={`${idp}-taxr`} name="tax_rate" inputMode="decimal" defaultValue={v.tax_rate} /></div>
        <div className="field" style={{ width: 170 }}><label className="label" htmlFor={`${idp}-due`}>Due date</label><input className="input" type="date" id={`${idp}-due`} name="due_date" defaultValue={v.due_date} /></div>
      </div>
    </>
  );
}
