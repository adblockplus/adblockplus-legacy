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

var abp;
var prefs;
var groupName;

function init() {
  abp = window.arguments[0];
  prefs = window.arguments[1];
  groupName = window.arguments[2];
  if (groupName && prefs.synch.has(groupName)) {
    var synchPrefs = prefs.synch.get(groupName);
    document.getElementById("location").value = groupName;
    document.getElementById("location").setAttribute("readonly", "true");
    document.getElementById("title").value = synchPrefs.title;
    document.getElementById("enabled").setAttribute("checked", !synchPrefs.disabled);
  
    if (synchPrefs.external) {
      document.getElementById("external-description").hidden = false;
      document.getElementById("autodownload").setAttribute("checked", "true");
      document.getElementById("autodownload").setAttribute("disabled", "true");
    }
    else {
      document.getElementById("edit-description").hidden = false;
      document.getElementById("autodownload").setAttribute("checked", synchPrefs.autodownload);
    }
  }
  else {
    document.title = document.documentElement.getAttribute("newtitle");
    document.getElementById("new-description").hidden = false;
    document.getElementById("enabled").setAttribute("checked", "true");
    document.getElementById("autodownload").setAttribute("checked", "true");
  }
}

function saveSubscription() {
  var group;
  var synchPrefs;
  var add = !groupName;
  if (add) {
    var name = document.getElementById("location").value.replace(/\s/g, "").replace(/^~+/, "");
    if (!name) {
      alert(abp.getString("subscription_no_location"));
      document.getElementById("location").focus();
      return false;
    }

    var file = Components.classes["@mozilla.org/file/local;1"]
                          .createInstance(Components.interfaces.nsILocalFile);
    try {
      file.initWithPath(name);
      var ioService = Components.classes["@mozilla.org/network/io-service;1"]
                                .getService(Components.interfaces.nsIIOService); 
      var protHandler = ioService.getProtocolHandler('file')
                                .QueryInterface(Components.interfaces.nsIFileProtocolHandler);
      var url = protHandler.newFileURI(file);
    } catch (e2) {
      try {
        var url = Components.classes["@mozilla.org/network/simple-uri;1"]
                            .createInstance(Components.interfaces.nsIURI);
        url.spec = name;
      } catch (e) {
        alert(abp.getString("subscription_invalid_location"));
        document.getElementById("location").focus();
        return false;
      }
    }

    groupName = url.spec;
    if (prefs.synch.has(groupName)) {
      alert(abp.getString("subscription_location_exists"));
      document.getElementById("location").focus();
      return false;
    }

    synchPrefs = {url: groupName, external: false, lastdownload: 0, lastsuccess: 0, downloadstatus: "", lastmodified: "", patterns: []};
    prefs.synch.put(groupName, synchPrefs);
  }
  else
    synchPrefs = prefs.synch.get(groupName);

  synchPrefs.title = document.getElementById("title").value.replace(/^\s+/, "").replace(/\s+$/, "");
  if (!synchPrefs.title)
    synchPrefs.title = groupName;

  synchPrefs.autodownload = document.getElementById("autodownload").checked;
  synchPrefs.disabled = !document.getElementById("enabled").checked;

  if (add) {
    opener.addSubscriptionGroup(groupName, synchPrefs);
    opener.groupManager.selectGroup(groupName);

    // Need delayed execution here for some reason, XMLHttpRequest will fail otherwise
    var synchronizer = abp.synchronizer;
    opener.setTimeout(function() {synchronizer.execute(synchPrefs)}, 0);
  }
  else
    opener.updateSubscriptionDescription(groupName, synchPrefs);

  prefs.save();
}
