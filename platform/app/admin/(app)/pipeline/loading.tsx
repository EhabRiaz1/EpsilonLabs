import { SkelHead, SkelPage, SkelRows, SkelTiles } from "@/app/components/Skeleton";

/** Pipeline while it loads: the KPI row and 8 table rows (plan: interaction states). */
export default function Loading() {
  return (
    <SkelPage label="Loading the pipeline">
      <SkelHead />
      <SkelTiles n={4} />
      <SkelRows n={8} />
    </SkelPage>
  );
}
