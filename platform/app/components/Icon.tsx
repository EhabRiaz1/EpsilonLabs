import { ICONS, type IconName } from "./icons";

/** Same markup motion.js's mountIcons produces, rendered on the server so hydration matches. */
export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <span className={className ? `i ${className}` : "i"}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        // constant path data from icons.ts, never user input
        dangerouslySetInnerHTML={{ __html: ICONS[name] }}
      />
    </span>
  );
}
