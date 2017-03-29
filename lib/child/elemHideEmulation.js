/*
 * This file is part of Adblock Plus <https://adblockplus.org/>,
 * Copyright (C) 2006-2017 eyeo GmbH
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
  let {getFrames, isPrivate} = require("child/utils");
  let {RequestNotifier} = require("child/requestNotifier");

  function getFilters(window, callback)
  {
    let message = {
      frames: getFrames(window),
      payload: {
        type: "filters.get",
        what: "elemhideemulation"
      }
    };
    port.emitWithResponse("ext_message", message).then(callback);
  }

  function addUserCSS(window, cssCode)
  {
    let uri = Services.io.newURI("data:text/css," + encodeURIComponent(cssCode),
        null, null);
    let utils = window.QueryInterface(Ci.nsIInterfaceRequestor)
                      .getInterface(Ci.nsIDOMWindowUtils);
    utils.loadSheet(uri, Ci.nsIDOMWindowUtils.USER_SHEET);
  }

  function initElemHideEmulation()
  {
    let scope = Object.assign({}, require("common"));
    Services.scriptloader.loadSubScript(
        "chrome://adblockplus/content/elemHideEmulation.js", scope);

    let onContentWindow = (subject, topic, data) =>
    {
      if (!(subject instanceof Ci.nsIDOMWindow))
        return;

      let onReady = event =>
      {
        subject.removeEventListener("load", onReady);
        let handler = new scope.ElemHideEmulation(
          subject, getFilters.bind(null, subject), (selectors, filters) =>
          {
            if (selectors.length == 0)
              return;

            addUserCSS(subject, selectors.map(
              selector => selector + "{display: none !important;}"
            ).join("\n"));

            if (!isPrivate(subject))
              port.emit("addHits", filters);

            let docDomain = null;
            try
            {
              // We are calling getFrames() here because it will consider
              // "inheritance" for about:blank and data: frames.
              docDomain = new URL(getFrames(subject)[0].location).hostname;
            }
            catch (e)
            {
              // Invalid URL?
            }

            for (let i = 0; i < filters.length; i++)
            {
              RequestNotifier.addNodeData(subject.document, subject.top, {
                contentType: "ELEMHIDE",
                docDomain: docDomain,
                thirdParty: false,
                location: "##" + selectors[i],
                filter: filters[i],
                filterType: "elemhideemulation"
              });
            }
          }
        );

        handler.apply();
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

  initElemHideEmulation();
})();
