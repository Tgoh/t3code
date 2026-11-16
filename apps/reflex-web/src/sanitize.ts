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

// A relative href is a file path an agent named, and following it would leave the app and lose drafts.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.nodeName !== "A") return;
  const href = node.getAttribute("href");
  if (href === null) return;
  if (parseThreadLinkHref(href) !== null) {
    node.removeAttribute("href");
    node.setAttribute("data-thread-href", href);
    node.setAttribute("class", "thread-link");
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
