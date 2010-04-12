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
  let appInfo = Components.classes["@mozilla.org/xre/app-info;1"]
                          .getService(Components.interfaces.nsIXULAppInfo);
  let isFennec = (appInfo.ID == "{a23983c0-fd0e-11dc-95ff-0800200c9a66}");

  // Use UIReady event to initialize in Fennec (bug 531071)
  window.addEventListener(isFennec ? "UIReady" : "load", function()
  {
    // Abuse sandboxes so get an execution context for our code
    let sandbox = new Components.utils.Sandbox(window);
    sandbox.window = window;
    sandbox.document = document;
    sandbox.isFennec = isFennec;
  
    let loader = Components.classes["@mozilla.org/moz/jssubscript-loader;1"]
                           .getService(Components.interfaces.mozIJSSubScriptLoader)
    loader.loadSubScript("chrome://adblockplus/content/ui/utils.js", sandbox);
    loader.loadSubScript("chrome://adblockplus/content/ui/browserWindow.js", sandbox);
    if (isFennec)
      loader.loadSubScript("chrome://adblockplus/content/ui/fennecOverlay.js", sandbox);
  }, false);
}
