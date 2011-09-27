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
 * Portions created by the Initial Developer are Copyright (C) 2006-2011
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * ***** END LICENSE BLOCK ***** */

var EXPORTED_SYMBOLS = ["Survey"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

let baseURL = Cc["@adblockplus.org/abp/private;1"].getService(Ci.nsIURI);

Cu.import(baseURL.spec + "Utils.jsm");
Cu.import(baseURL.spec + "Prefs.jsm");
Cu.import(baseURL.spec + "AppIntegration.jsm");

var Survey =
{
  startup: initSurvey
};

let surveyTimer = null;
let surveyLang = null;

let langData = {
  en: {
    title: "Tell us your opinion",
    question: "We would like to ask you a few questions about Adblock Plus to help us improve it. If you can spare 5 minutes please click the button below to take the survey.",
    note: "This is a one-time message and will not appear again.",
    accept: "Take the survey",
    decline: "Maybe some other time"
  },
  de: {
    title: "Sagen Sie uns Ihre Meinung",
    question: "Wir w\xFCrden Ihnen gerne einige Fragen zu Adblock Plus stellen, um es verbessern zu k\xF6nnen. Falls Sie gerade 5 Minuten haben, dr\xFCcken Sie bitte die Taste unten, um an der Nutzerumfrage teilzunehmen.",
    note: "Das ist eine einmalige Nachricht, die nicht wieder erscheinen wird.",
    accept: "An der Umfrage teilnehmen",
    decline: "Vielleicht ein anderes Mal"
  },
  ru: {
    title: decodeURIComponent("%D0%9F%D0%BE%D0%B4%D0%B5%D0%BB%D0%B8%D1%82%D0%B5%D1%81%D1%8C%20%D1%81%20%D0%BD%D0%B0%D0%BC%D0%B8%20%D1%81%D0%B2%D0%BE%D0%B8%D0%BC%20%D0%BC%D0%BD%D0%B5%D0%BD%D0%B8%D0%B5%D0%BC"),
    question: decodeURIComponent("%D0%9C%D1%8B%20%D1%85%D0%BE%D1%82%D0%B5%D0%BB%D0%B8%20%D0%B1%D1%8B%20%D0%B7%D0%B0%D0%B4%D0%B0%D1%82%D1%8C%20%D0%B2%D0%B0%D0%BC%20%D0%BD%D0%B5%D0%BA%D0%BE%D1%82%D0%BE%D1%80%D1%8B%D0%B5%20%D0%B2%D0%BE%D0%BF%D1%80%D0%BE%D1%81%D1%8B%20%D0%BE%D0%B1%20Adblock%20Plus%2C%20%D1%87%D1%82%D0%BE%D0%B1%D1%8B%20%D0%BB%D1%83%D1%87%D1%88%D0%B5%20%D0%BE%D0%BF%D1%80%D0%B5%D0%B4%D0%B5%D0%BB%D0%B8%D1%82%D1%8C%20%D0%BD%D0%B0%D0%BF%D1%80%D0%B0%D0%B2%D0%BB%D0%B5%D0%BD%D0%B8%D0%B5%20%D0%B4%D0%BB%D1%8F%20%D0%B5%D0%B3%D0%BE%20%D0%B4%D0%B0%D0%BB%D1%8C%D0%BD%D0%B5%D0%B9%D1%88%D0%B5%D0%B3%D0%BE%20%D1%80%D0%B0%D0%B7%D0%B2%D0%B8%D1%82%D0%B8%D1%8F.%20%D0%95%D1%81%D0%BB%D0%B8%20%D1%83%20%D0%B2%D0%B0%D1%81%20%D0%B5%D1%81%D1%82%D1%8C%20%D1%81%D0%B2%D0%BE%D0%B1%D0%BE%D0%B4%D0%BD%D1%8B%D0%B5%205%20%D0%BC%D0%B8%D0%BD%D1%83%D1%82%2C%20%D1%82%D0%BE%20%D0%BD%D0%B0%D0%B6%D0%BC%D0%B8%D1%82%D0%B5%2C%20%D0%BF%D0%BE%D0%B6%D0%B0%D0%BB%D1%83%D0%B9%D1%81%D1%82%D0%B0%2C%20%D0%BD%D0%B0%20%D0%BA%D0%BD%D0%BE%D0%BF%D0%BA%D1%83%2C%20%D1%87%D1%82%D0%BE%D0%B1%D1%8B%20%D0%BF%D1%80%D0%B8%D0%BD%D1%8F%D1%82%D1%8C%20%D1%83%D1%87%D0%B0%D1%81%D1%82%D0%B8%D0%B5%20%D0%B2%20%D0%BE%D0%BF%D1%80%D0%BE%D1%81%D0%B5."),
    note: decodeURIComponent("%D0%AD%D1%82%D0%BE%20%D0%BE%D0%B4%D0%BD%D0%BE%D1%80%D0%B0%D0%B7%D0%BE%D0%B2%D0%BE%D0%B5%20%D1%81%D0%BE%D0%BE%D0%B1%D1%89%D0%B5%D0%BD%D0%B8%D0%B5%2C%20%D0%BE%D0%BD%D0%BE%20%D0%B1%D0%BE%D0%BB%D1%8C%D1%88%D0%B5%20%D0%BD%D0%B5%20%D0%B1%D1%83%D0%B4%D0%B5%D1%82%20%D0%BF%D0%BE%D0%BA%D0%B0%D0%B7%D1%8B%D0%B2%D0%B0%D1%82%D1%8C%D1%81%D1%8F."),
    accept: decodeURIComponent("%D0%9F%D1%80%D0%B8%D0%BD%D1%8F%D1%82%D1%8C%20%D1%83%D1%87%D0%B0%D1%81%D1%82%D0%B8%D0%B5%20%D0%B2%20%D0%BE%D0%BF%D1%80%D0%BE%D1%81%D0%B5"),
    decline: decodeURIComponent("%D0%9C%D0%BE%D0%B6%D0%B5%D1%82%20%D0%B2%20%D0%B4%D1%80%D1%83%D0%B3%D0%BE%D0%B9%20%D1%80%D0%B0%D0%B7")
  }
};

function initSurvey()
{
  // Only look at users updating from another 1.3.x version
  let prevVersion = Prefs.currentVersion;
  let currentVersion = Utils.addonVersion;
  if (prevVersion == currentVersion || Utils.versionComparator.compare(prevVersion, "1.3") < 0)
    return;

  // Don't ask after 2011-11-10
  if (Date.now() > 1320883200000)
    return;

  // Only Firefox users
  if (Utils.appID != "{ec8030f7-c20a-464f-9b0e-13a3a9e97384}")
    return;

  // Only Firefox 4 and higher
  if (Utils.versionComparator.compare(Utils.platformVersion, "2.0") < 0)
    return;

  // Survey is only available in English/German/Russian
  if (!/^(en|de|ru)\b/.test(Utils.appLocale))
    return;
  surveyLang = RegExp.$1;

  // Only ask 0.5% of the users
  if (Math.random() > 0.005)
    return;

  // Delay survey question by 20 seconds
  surveyTimer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
  surveyTimer.initWithCallback(runSurvey, 20000, Ci.nsITimer.TYPE_ONE_SHOT);
}

function runSurvey()
{
  surveyTimer = null;

  let browser = Utils.windowMediator.getMostRecentWindow("navigator:browser");
  if (!browser)
    return;

  let wrapper = AppIntegration.getWrapperForWindow(browser);
  if (!wrapper)
    return null;

  let button = wrapper.E("abp-toolbarbutton") || wrapper.E("abp-status");
  if (!button)
    return;

  let lang = langData[surveyLang];
  let panel = new wrapper.window.DOMParser().parseFromString('\
    <panel xmlns="http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul" id="abp-survey-message" type="arrow" orient="vertical">\
      <description class="title"/>\
      <description class="question" maxwidth="300"/>\
      <hbox>\
        <button class="accept" dlgtype="accept"/>\
        <spacer flex="1"/>\
        <button class="decline" dlgtype="cancel"/>\
      </hbox>\
      <description class="note" maxwidth="300"/>\
    </panel>\
  ', "text/xml").documentElement;
  panel.getElementsByClassName("title")[0].setAttribute("value", lang.title);
  panel.getElementsByClassName("question")[0].textContent = lang.question;
  panel.getElementsByClassName("note")[0].textContent = lang.note;
  let (button = panel.getElementsByClassName("accept")[0])
  {
    button.setAttribute("label", lang.accept);
    button.addEventListener("command", function()
    {
      panel.hidePopup();
      openSurveyTab(wrapper);
    }, false);
  }
  let (button = panel.getElementsByClassName("decline")[0])
  {
    button.setAttribute("label", lang.decline);
    button.addEventListener("command", function()
    {
      panel.hidePopup();
    }, false);
  }
  wrapper.E("abp-popupset").appendChild(panel);
  panel.openPopup(button, "bottomcenter topcenter", 0, 0, false, false, null);
}

function openSurveyTab(wrapper)
{
  wrapper.window.gBrowser.loadOneTab("http://adblockplus.org/usersurvey/index.php?sid=68316&lang=" + surveyLang, {
    referrerURI: Utils.makeURI("http://adblock.plus/"),
    inBackground: false
  });
}
