import { SkelHead, SkelPage, SkelRows } from "@/app/components/Skeleton";

/** Approvals while it loads: the header and three queue rows (plan: interaction states). */
export default function Loading() {
  return (
    <SkelPage label="Loading the queue">
      <SkelHead />
      <SkelRows n={3} />
    </SkelPage>
  );
}
