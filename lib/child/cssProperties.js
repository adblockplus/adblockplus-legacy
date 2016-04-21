/*
 * This file is part of Adblock Plus <https://adblockplus.org/>,
 * Copyright (C) 2006-2016 Eyeo GmbH
 *
 * Adblock Plus is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3 as
 * published by the Free Software Foundation.
 *
 * Adblock Plus is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Adblock Plus.  If not, see <http://www.gnu.org/licenses/>.
 */

"use strict";

(function()
{
  let {Services} = Cu.import("resource://gre/modules/Services.jsm", {});

  let {port} = require("messaging");
  let {getFrames} = require("child/utils");

  let senderWindow = null;

  let scope = {
    ext: {
      backgroundPage: {
        sendMessage: function(payload, callback)
        {
          let message = {payload, frames: getFrames(senderWindow)};
          if (typeof callback == "function")
            port.emitWithResponse("ext_message", message).then(callback);
          else
            port.emit("ext_message", message);
        }
      }
    }
  };

  function addUserCSS(window, cssCode)
  {
    let uri = Services.io.newURI("data:text/css," + encodeURIComponent(cssCode),
        null, null);
    let utils = window.QueryInterface(Ci.nsIInterfaceRequestor)
                      .getInterface(Ci.nsIDOMWindowUtils);
    utils.loadSheet(uri, Ci.nsIDOMWindowUtils.USER_SHEET);
  }

  function initCSSPropertyFilters()
  {
    Services.scriptloader.loadSubScript(
        "chrome://adblockplus/content/cssProperties.js", scope);

    let onContentWindow = (subject, topic, data) =>
    {
      if (!(subject instanceof Ci.nsIDOMWindow))
        return;

      let onReady = event =>
      {
        subject.removeEventListener("load", onReady);
        let handler = new scope.CSSPropertyFilters(subject, selectors =>
        {
          if (selectors.length == 0)
            return;

          addUserCSS(subject, selectors.map(
            selector => selector + "{display: none !important;}"
          ).join("\n"));
        });

        // HACK: The content script just calls ext.backgroundPage.sendMessage
        // without indicating which window this is about. We'll store the window
        // here because we know that messaging happens synchronously.
        senderWindow = subject;
        handler.load(() => handler.apply());
        senderWindow = null;
      };

      subject.addEventListener("load", onReady);
    };

    Services.obs.addObserver(onContentWindow, "content-document-global-created",
        false);
    onShutdown.add(() =>
    {
      Services.obs.removeObserver(onContentWindow,
          "content-document-global-created");
    });
  }

  initCSSPropertyFilters();
})();
