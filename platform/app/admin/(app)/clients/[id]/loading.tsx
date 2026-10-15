import { SkelHead, SkelPage, SkelPanel, SkelRows, SkelTiles } from "@/app/components/Skeleton";

/** A client while it loads: header, the four stats, project cards, then activity | money + people. */
export default function Loading() {
  return (
    <SkelPage label="Loading the client">
      <SkelHead crumbs />
      <SkelTiles n={4} />
      <div className="skel-split rev">
        <SkelPanel h={150} />
        <SkelPanel h={150} />
      </div>
      <div className="skel-split rev">
        <SkelRows n={7} />
        <div className="skel-stack">
          <SkelRows n={3} />
          <SkelRows n={3} />
        </div>
      </div>
    </SkelPage>
  );
}
