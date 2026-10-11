import { Icon } from "@/app/components/Icon";
import { MenuButton } from "@/app/components/ShellControls";

/** Signed in, but not (or no longer) a member of any organisation. */
export function NoOrg({ email }: { email?: string }) {
  return (
    <>
      <header className="greet">
        <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
          <MenuButton />
          <div>
            <h1>Welcome</h1>
            <div className="date">{email}</div>
          </div>
        </div>
      </header>
      <section className="panel">
        <div className="empty">
          <div className="orb">
            <span className="wave" />
            <span className="wave" />
            <span className="core">
              <Icon name="users" className="i-lg" />
            </span>
          </div>
          <h2 className="display">You aren&apos;t in an organisation yet</h2>
          <p className="c-2" style={{ maxWidth: "42ch" }}>
            When someone invites you, the link in their email adds you and opens the portal. If you expected access, ask your
            organisation&apos;s owner or email er@epsilon-labs.co.
          </p>
        </div>
      </section>
    </>
  );
}
