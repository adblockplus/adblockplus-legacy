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
 *
 * ***** END LICENSE BLOCK ***** */

var fennecAbp = {
    abp : Components.classes["@mozilla.org/adblockplus;1"].createInstance().wrappedJSObject,
    
    init: function(event) {
       fennecAbp.abp.init();
    },
    
    onCreateOptions: function(event) {
        if (event.originalTarget.getAttribute("addonID") != "{d10d0bf8-f5b5-c8b4-a8b2-2b9879e08c5d}")
          return;
        
        let abp = Components.classes["@mozilla.org/adblockplus;1"].createInstance().wrappedJSObject;
        for (let i = 0; i < fennecAbp.abp.subscriptionCount; i++) {
            let sub = fennecAbp.abp.getSubscriptionAt(i);
        }
        
        let wanted = null;
        if (fennecAbp.abp.subscriptionCount == 5) {
            let sub = fennecAbp.abp.getSubscriptionAt(4);
            wanted = sub.title;
        }
        
        let menu = document.getElementById("adblockplus-subscription-list");
        
        let xhr = new XMLHttpRequest();
        xhr.open("GET", "chrome://adblockplus/content/ui/subscriptions.xml", false);
        xhr.send(null);
        if (!xhr.responseXML) {
          return;
        }
        let subscriptions = xhr.responseXML.querySelectorAll(":root > subscription");
        let selected = -1;
        for (let i = 0; i < subscriptions.length; i++) {
            let item = subscriptions.item(i);
            menu.appendItem(item.getAttribute("title"), item.getAttribute("url"), null);
            if (wanted == item.getAttribute("title"))
              selected = i;
        }
        if (selected != -1)
          menu.selectedIndex = selected;
    },
    
    // we only allow one subscription in addition to the 4 predefined ones
    setSubscription: function(event) {
        let node = event.target;
        if (fennecAbp.abp.subscriptionCount == 5) {
            let sub = fennecAbp.abp.getSubscriptionAt(4);
            fennecAbp.abp.filterStorage.removeSubscription(sub);
        }
        fennecAbp.abp.addSubscription(node.value, node.label, true, false);
    }
}

document.getElementById("addons-list").addEventListener("AddonOptionsLoad", 
        fennecAbp.onCreateOptions, false);

window.addEventListener("load", fennecAbp.init(), false);
