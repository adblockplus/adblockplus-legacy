/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Adblock Plus.
 *
 * The Initial Developer of the Original Code is
 * Fabrice Desré.
 * Portions created by the Initial Developer are Copyright (C) 2006-2011
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *  Wladimir Palant
 *
 * ***** END LICENSE BLOCK ***** */

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
