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
 * Portions created by the Initial Developer are Copyright (C) 2006-2009
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *  Wladimir Palant
 *
 * ***** END LICENSE BLOCK ***** */

function onCreateOptions(event)
{
  if (event.originalTarget.getAttribute("addonID") != "{d10d0bf8-f5b5-c8b4-a8b2-2b9879e08c5d}")
    return;

  E("adblockplus-subscription-list").addEventListener("command", function(event)
  {
    let menu = event.target;
    if (menu.value)
      setSubscription(menu.value, menu.label);
  }, false);

  updateSubscriptionList();
  abp.filterStorage.addSubscriptionObserver(updateSubscriptionList);

  window.addEventListener("unload", function()
  {
    abp.filterStorage.removeSubscriptionObserver(updateSubscriptionList);
  }, false);
}

function updateSubscriptionList()
{
  let filterStorage = abp.filterStorage;
  let currentSubscription = filterStorage.subscriptions.filter(function(subscription) subscription instanceof abp.DownloadableSubscription);
  currentSubscription = (currentSubscription.length ? currentSubscription[0] : null);
  
  let xhr = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(Ci.nsIJSXMLHttpRequest);
  xhr.open("GET", "chrome://adblockplus/content/ui/subscriptions.xml", false);
  xhr.send(null);
  if (!xhr.responseXML)
    return;

  let menu = E("adblockplus-subscription-list");
  menu.removeAllItems();

  let subscriptions = xhr.responseXML.documentElement.getElementsByTagName("subscription");
  for (let i = 0; i < subscriptions.length; i++)
  {
    let item = subscriptions[i];
    let url = item.getAttribute("url");
    if (!url)
      continue;

    menu.appendItem(item.getAttribute("title"), url, null);
    if (currentSubscription && url == currentSubscription.url)
      menu.selectedIndex = menu.itemCount - 1;
  }

  if (currentSubscription && menu.selectedIndex < 0)
  {
    menu.appendItem(currentSubscription.title, currentSubscription.url, null);
    menu.selectedIndex = menu.itemCount - 1;
  }
}
  
function setSubscription(url, title)
{
  let filterStorage = abp.filterStorage;
  let currentSubscription = filterStorage.subscriptions.filter(function(subscription) subscription instanceof abp.DownloadableSubscription);
  currentSubscription = (currentSubscription.length ? currentSubscription[0] : null);
  if (currentSubscription && currentSubscription.url == url)
    return;

  // We only allow one subscription, remove existing one before adding
  if (currentSubscription)
    filterStorage.removeSubscription(currentSubscription);

  currentSubscription = abp.Subscription.fromURL(url);
  currentSubscription.title = title;

  filterStorage.addSubscription(currentSubscription);
  abp.synchronizer.execute(currentSubscription);
  filterStorage.saveToDisk();
}

function initFennecSubscriptionDialog(url, title)
{
  // Copied from Fennec's PromptService.js
  // add a width style to prevent a element to grow larger 
  // than the screen width
  function sizeElement(id, percent)
  {
    let elem = E(id);
    let screenW = E("main-window").getBoundingClientRect().width;
    elem.style.width = screenW * percent / 100 + "px"
  }
  
  // size the height of the scrollable message. this assumes the given element
  // is a child of a scrollbox
  function sizeScrollableMsg(id, percent)
  {
    let screenH = E("main-window").getBoundingClientRect().height;
    let maxHeight = screenH * percent / 100;
    
    let elem = E(id);
    let style = document.defaultView.getComputedStyle(elem, null);
    let height = Math.ceil(elem.getBoundingClientRect().height) +
                 parseInt(style.marginTop) +
                 parseInt(style.marginBottom);
  
    if (height > maxHeight)
      height = maxHeight;
    elem.parentNode.style.height = height + "px";
  }

  sizeElement("abp-subscription-title", 50);
  E("abp-subscription-title").textContent = title;

  sizeElement("abp-subscription-url", 50);
  E("abp-subscription-url").textContent = url;
  sizeScrollableMsg("abp-subscription-url", 50);

  E("abp-subscription-cmd-ok").addEventListener("command", function()
  {
    setSubscription(url, title);
    E("abpEditSubscription").close();
  }, false);

  E("abp-subscription-btn-ok").focus();
}

abp.runAsync(function() abp.init());

E("addons-list").addEventListener("AddonOptionsLoad", onCreateOptions, false);
