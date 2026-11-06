import { cn } from '../lib/utils';

/**
 * Claude's logo as supplied by the owner (2026-11-06, F-116), traced to one shape for a sharp
 * mark at any size; its colour comes from the `claude-mark` role (the logo's #D97757 in the
 * light theme). Shown wherever Claude drafted something, always beside the words "Drafted by
 * Claude" (or with `label`), never alone.
 */
const CLAUDE_LOGO_PATH =
  'M251 5 L223 44 L224 64 L233 98 L261 142 L317 239 L376 352 L370 357 L143 184 L99 180 ' +
  'L74 208 L79 246 L95 268 L123 286 L178 327 L372 455 L382 464 L379 471 L357 471 L260 459 ' +
  'L20 444 L2 456 L0 470 L20 498 L41 503 L227 513 L376 517 L380 524 L378 531 L372 536 ' +
  'L193 635 L113 690 L103 700 L101 729 L120 748 L165 742 L418 577 L422 578 L422 583 ' +
  'L380 631 L215 847 L212 874 L241 888 L256 882 L327 807 L470 611 L476 611 L477 615 ' +
  'L470 638 L459 715 L418 913 L430 939 L454 959 L483 948 L496 931 L523 644 L528 640 ' +
  'L574 719 L632 806 L687 881 L714 887 L738 877 L744 865 L740 825 L738 819 L628 655 ' +
  'L629 647 L636 649 L744 741 L832 808 L846 810 L858 792 L854 769 L681 612 L628 560 ' +
  'L629 556 L639 556 L905 620 L953 597 L956 593 L958 576 L942 553 L909 532 L790 522 ' +
  'L698 521 L635 515 L632 512 L635 509 L774 477 L869 458 L942 440 L955 409 L952 393 ' +
  'L918 377 L789 399 L672 425 L662 425 L659 422 L689 366 L818 199 L831 151 L802 108 ' +
  'L760 108 L743 121 L704 160 L680 188 L560 339 L552 339 L564 265 L591 142 L604 52 L584 24 ' +
  'L559 15 L532 33 L516 70 L505 202 L494 291 L490 364 L483 366 L470 324 L384 158 L324 19 ' +
  'L306 5 L272 0 Z';

export function ClaudeMark({ className, label }: { className?: string; label?: string }) {
  return (
    <svg
      viewBox="0 0 960 960"
      fill="currentColor"
      className={cn('size-4 shrink-0 text-claude-mark', className)}
      {...(label === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
    >
      <path d={CLAUDE_LOGO_PATH} />
    </svg>
  );
}
