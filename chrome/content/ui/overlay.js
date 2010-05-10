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
 * Portions created by the Initial Developer are Copyright (C) 2006-2010
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * ***** END LICENSE BLOCK ***** */

{
  let Cc = Components.classes;
  let Ci = Components.interfaces;
  let Cr = Components.results;
  let Cu = Components.utils;

  // Use UIReady event to initialize in Fennec (bug 531071)
  let isFennec = (Cc["@mozilla.org/xre/app-info;1"].getService(Ci.nsIXULAppInfo).ID == "{a23983c0-fd0e-11dc-95ff-0800200c9a66}");
  let eventName = isFennec ? "UIReady" : "load";

  window.addEventListener(eventName, function()
  {
    window.removeEventListener(eventName, arguments.callee, false);

    let modules = {};
    if (!("@adblockplus.org/abp/private;1" in Cc))
    {
      // Force initialization (in Fennec we won't be initialized at this point)
      let chromeRegistry = Cc["@mozilla.org/chrome/chrome-registry;1"].getService(Ci.nsIChromeRegistry);
      let ioService = Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService);
      let bootstrapURL = chromeRegistry.convertChromeURL(ioService.newURI("chrome://adblockplus-modules/content/Bootstrap.jsm", null, null));
      Cu.import(bootstrapURL.spec, modules);
      modules.Bootstrap.startup();
    }

    let baseURL = Cc["@adblockplus.org/abp/private;1"].getService(Ci.nsIURI);
    Cu.import(baseURL.spec + "AppIntegration.jsm", modules);
    modules.AppIntegration.addWindow(window);
  }, false);
}
