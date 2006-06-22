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
 * Wladimir Palant.
 * Portions created by the Initial Developer are Copyright (C) 2006
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * ***** END LICENSE BLOCK ***** */

var abp = Components.classes["@mozilla.org/adblockplus;1"].createInstance();
while (abp && !("getString" in abp))
  abp = abp.wrappedJSObject;    // Unwrap component

var prefs = abp.prefs;

function addSubscriptions() {
  var added = false;
  var checkboxes = document.getElementsByTagName("checkbox");
  for (var i = 0; i < checkboxes.length; i++) {
    if (checkboxes[i].checked) {
      var title = checkboxes[i].getAttribute("_title");
      var url = checkboxes[i].getAttribute("_url");
  
      var subscription = (prefs.knownSubscriptions.has(url) ? prefs.knownSubscriptions.get(url) : prefs.subscriptionFromURL(url));
      if (!subscription)
        continue;
  
      var found = false;
      for (var j = 0; j < prefs.subscriptions.length; j++)
        if (prefs.subscriptions[j] == subscription)
          found = true;
  
      if (found)
        continue;
  
      subscription.title = title;
      prefs.subscriptions.push(subscription);
  
      abp.synchronizer.notifyListeners(subscription, "add");
      abp.synchronizer.execute(subscription);
  
      added = true;
    }
  }
  if (added)
    prefs.savePatterns();
}
