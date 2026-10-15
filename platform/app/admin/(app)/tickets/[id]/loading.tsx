import { SkelHead, SkelPage, SkelPanel, SkelRows } from "@/app/components/Skeleton";

/** One ticket while it loads: breadcrumb header, the stepper, the work column and the reply + timeline rail. */
export default function Loading() {
  return (
    <SkelPage label="Loading the ticket">
      <SkelHead crumbs />
      <SkelPanel h={96} />
      <div className="skel-split rev">
        <div className="skel-stack">
          <SkelPanel h={240} />
          <SkelPanel h={200} />
        </div>
        <div className="skel-stack">
          <SkelPanel h={180} />
          <SkelRows n={5} />
        </div>
      </div>
    </SkelPage>
  );
}
