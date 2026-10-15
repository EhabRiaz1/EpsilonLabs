import { SkelHead, SkelPage, SkelRows } from "@/app/components/Skeleton";

/** Tickets while they load. */
export default function Loading() {
  return (
    <SkelPage label="Loading tickets">
      <SkelHead />
      <SkelRows n={8} />
    </SkelPage>
  );
}
