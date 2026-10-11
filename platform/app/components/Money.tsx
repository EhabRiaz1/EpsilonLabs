import { splitMoney } from "@/lib/money";

/** Amount with greyed decimals (design system): $7,200<span class="dec">.00</span>. */
export function Money({ value, currency, className }: { value: number | string; currency: string; className?: string }) {
  const { whole, dec } = splitMoney(value, currency);
  return (
    <span className={className ?? "money"}>
      {whole}
      <span className="dec">{dec}</span>
    </span>
  );
}
