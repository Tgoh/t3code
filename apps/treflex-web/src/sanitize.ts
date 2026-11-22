import { LOCAL_FILE_LINK_SCHEMES } from "@t3tools/contracts";
import { parseThreadLinkHref } from "@t3tools/shared/threadLinks";
import DOMPurify from "dompurify";

import { isEditorLinkHref } from "./fileLinks";

// Follows the tag list rehype-sanitize's default schema gives stock's assistant messages.
const ALLOWED_TAGS = [
  ..."h1 h2 h3 h4 h5 h6 br b i strong em a pre code img tt div ins del sup sub p ol ul".split(" "),
  ..."table thead tbody tfoot tr td th blockquote dl dt dd kbd q samp var hr ruby rt rp".split(" "),
  ..."li s strike summary details caption figure figcaption abbr bdo cite dfn mark small".split(
    " ",
  ),
  ..."span time wbr".split(" "),
];
const ALLOWED_ATTR = "href src alt open colspan rowspan align start reversed".split(" ");

export const EXTERNAL_LINK = /^(?:https?:|mailto:)/i;

const THREAD_LINK_BASE =
  "inline rounded-sm border-0 bg-transparent p-0 font-medium [text-align:inherit] [&_svg]:size-[1em] [&>:first-child]:mr-[0.2em] [&>:first-child]:align-[-0.15em]";

export const THREAD_LINK = `${THREAD_LINK_BASE} cursor-pointer text-(color:--thread-link)`;

// The anchor's colour comes from .chat-markdown a:not([href]), which it always sits under.
const THREAD_ANCHOR = `${THREAD_LINK_BASE} cursor-pointer`;

export const THREAD_LINK_UNAVAILABLE = `${THREAD_LINK_BASE} cursor-default text-inherit`;

// A relative href is a file path an agent named, and following it would leave the app and lose drafts.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.nodeName !== "A") return;
  const href = node.getAttribute("href");
  if (href === null) return;
  if (parseThreadLinkHref(href) !== null) {
    node.removeAttribute("href");
    node.setAttribute("data-thread-href", href);
    node.setAttribute("class", THREAD_ANCHOR);
  } else if (EXTERNAL_LINK.test(href)) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  } else if (!isEditorLinkHref(href)) {
    node.removeAttribute("href");
    node.setAttribute("data-tip", href);
  }
});

// DOMPurify's default URI pattern, plus the editors' own schemes so their file links survive.
const ALLOWED_URI_REGEXP = new RegExp(
  `^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix|${LOCAL_FILE_LINK_SCHEMES.join("|")}):|[^a-z]|[a-z+.\\-]+(?:[^a-z+.\\-:]|$))`,
  "i",
);

export const sanitizeHtml = (html: string): string =>
  DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP,
    ADD_ATTR: ["target", "rel"],
  });
