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
 * Portions created by the Initial Developer are Copyright (C) 2006-2007
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * ***** END LICENSE BLOCK ***** */

abpWrapper* wrapper = new abpWrapper();
char labelValues[NUM_LABELS][100];

static WNDPROC origWndProc = NULL;
static WNDPROC origDialogWndProc = NULL;
static HIMAGELIST hImages = NULL;
static HHOOK hook = NULL;
static WORD cmdBase = 0;
static nsCOMPtr<nsIDOMWindowInternal> fakeBrowserWindow;

kmeleonFunctions* abpWrapper::kFuncs = NULL;
nsCOMPtr<nsIWindowWatcher> abpWrapper::watcher;
nsCOMPtr<nsIIOService> abpWrapper::ioService;
nsCOMPtr<nsIPrincipal> abpWrapper::systemPrincipal;
abpToolbarDataList abpWrapper::toolbarList;
abpStatusBarList abpWrapper::statusbarList;
