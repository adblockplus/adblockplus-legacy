/*
 * This Source Code is subject to the terms of the Mozilla Public License
 * version 2.0 (the "License"). You can obtain a copy of the License at
 * http://mozilla.org/MPL/2.0/.
 */

if (!("@adblockplus.org/abp/policy;1" in Components.classes))
  Components.utils.import("chrome://adblockplus-modules/content/ContentPolicyRemote.jsm");
if (!("@mozilla.org/network/protocol/about;1?what=abp-elemhidehit" in Components.classes))
  Components.utils.import("chrome://adblockplus-modules/content/ElemHideRemote.jsm");

addEventListener("click", function(event)
{
  // Ignore right-clicks
  if (event.button == 2)
    return;

  // Search the link associated with the click
  let link = event.target;
  while (link && !(link instanceof Ci.nsIDOMHTMLAnchorElement))
    link = link.parentNode;

  if (!link || !/^abp:\/*subscribe\/*\?(.*)/i.test(link.href))  /**/
    return;

  // This is our link - make sure the browser doesn't handle it
  event.preventDefault();
  event.stopPropagation();

  sendAsyncMessage("AdblockPlus:LinkClick", link.href);
}, true);
