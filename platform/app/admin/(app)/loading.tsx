import { SkelHead, SkelPage, SkelPanel, SkelRows, SkelTiles } from "@/app/components/Skeleton";

/** Today's first screen while it loads (also the fallback for admin pages without their own loading.tsx). */
export default function Loading() {
  return (
    <SkelPage>
      <SkelHead />
      <SkelTiles n={4} />
      <div className="skel-split">
        <SkelPanel h={300} />
        <div className="skel-stack">
          <SkelTiles n={5} tall />
          <SkelPanel h={170} />
        </div>
      </div>
      <div className="skel-split rev">
        <SkelRows n={7} />
        <SkelRows n={5} />
      </div>
    </SkelPage>
  );
}
