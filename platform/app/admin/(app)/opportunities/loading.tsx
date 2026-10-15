import { SkelHead, SkelPage, SkelRows } from "@/app/components/Skeleton";

/** Opportunities while they load: 8 rows (plan: interaction states). */
export default function Loading() {
  return (
    <SkelPage label="Loading opportunities">
      <SkelHead />
      <SkelRows n={8} />
    </SkelPage>
  );
}
