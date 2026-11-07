/**
 * "Skip to main content" link (Requirement 34.7). Render it as the first focusable element of
 * the page. It is visually hidden until focused (`.skip-link` in base.css). Activating it moves
 * keyboard focus to the element with `targetId` (the page's `<main tabIndex="-1">`), so the
 * next Tab press reaches the first focusable element inside `main`.
 *
 * The default hash navigation is prevented: it would add a history entry and does not move
 * focus to a `tabIndex="-1"` element in every browser.
 *
 * @param {{ targetId?: string }} props
 */
export function SkipLink({ targetId = 'main' }) {
  const handleClick = (event) => {
    const target = document.getElementById(targetId);
    if (!target) return;
    event.preventDefault();
    target.focus();
  };

  return (
    <a className="skip-link" href={`#${targetId}`} onClick={handleClick}>
      Skip to main content
    </a>
  );
}

export default SkipLink;
