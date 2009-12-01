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

var fennecAbp = {
  abp: Components.classes["@mozilla.org/adblockplus;1"].createInstance().wrappedJSObject,
  
  onCreateOptions: function(event)
  {
    if (event.originalTarget.getAttribute("addonID") != "{d10d0bf8-f5b5-c8b4-a8b2-2b9879e08c5d}")
      return;
    
    // We need the component to be initialized at this point if it isn't already
    this.abp.init();

    let filterStorage = this.abp.filterStorage;
    let currentSubscription = filterStorage.subscriptions.filter(function(subscription) subscription instanceof this.abp.DownloadableSubscription, this);
    currentSubscription = (currentSubscription.length ? currentSubscription[0] : null);
    
    let menu = document.getElementById("adblockplus-subscription-list");
    
    let xhr = new XMLHttpRequest();
    xhr.open("GET", "chrome://adblockplus/content/ui/subscriptions.xml", false);
    xhr.send(null);
    if (!xhr.responseXML)
      return;

    let subscriptions = xhr.responseXML.documentElement.getElementsByTagName("subscription");
    for (let i = 0; i < subscriptions.length; i++)
    {
      let item = subscriptions[i];
      menu.appendItem(item.getAttribute("title"), item.getAttribute("url"), null);
      if (currentSubscription && item.getAttribute("url") == currentSubscription.url)
        menu.selectedIndex = menu.itemCount - 1;
    }

    if (currentSubscription && menu.selectedIndex < 0)
    {
      menu.appendItem(currentSubscription.title, currentSubscription.url, null);
      menu.selectedIndex = menu.itemCount - 1;
    }
  },
  
  setSubscription: function(event)
  {
    let menu = event.target;
    if (!menu.value)
      return;

    let filterStorage = this.abp.filterStorage;
    let currentSubscription = filterStorage.subscriptions.filter(function(subscription) subscription instanceof this.abp.DownloadableSubscription, this);
    currentSubscription = (currentSubscription.length ? currentSubscription[0] : null);
    if (currentSubscription && currentSubscription.url == menu.value)
      return;

    // We only allow one subscription, remove existing one before adding
    if (currentSubscription)
      filterStorage.removeSubscription(currentSubscription);

    currentSubscription = this.abp.Subscription.fromURL(menu.value);
    currentSubscription.title = menu.label;

    filterStorage.addSubscription(currentSubscription);
    this.abp.synchronizer.execute(currentSubscription);
    filterStorage.saveToDisk();
  }
}

document.getElementById("addons-list").addEventListener("AddonOptionsLoad",
      function(event) fennecAbp.onCreateOptions(event), false);
