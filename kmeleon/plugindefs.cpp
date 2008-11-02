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

#include "adblockplus.h"

kmeleonFunctions* kFuncs = NULL;

kmeleonPlugin kPlugin = {
  KMEL_PLUGIN_VER,
  PLUGIN_NAME,
  &DoMessage
};

extern "C" {
  KMELEON_PLUGIN kmeleonPlugin *GetKmeleonPlugin() {
    return &kPlugin;
  }
}

char* imagesURL = "chrome://adblockplus/skin/abp-status-16.png";
HIMAGELIST hImages = ImageList_Create(16, 16, ILC_COLOR32, 4, 0);
nsCOMPtr<imgIRequest> imageRequest;

LONG DoMessage(LPCSTR to, LPCSTR from, LPCSTR subject, LONG data1, LONG data2)
{
  if (to[0] != '*' && _stricmp(to, kPlugin.dllname) != 0)
    return 0;

  LONG ret = 1;
  if (_stricmp(subject, "Load") == 0)
    ret = (Load() ? 1 : -1);
  else if (_stricmp(subject, "Setup") == 0)
    Setup();
  else if (_stricmp(subject, "Create") == 0)
    Create((HWND)data1);
  else if (_stricmp(subject, "Close") == 0)
    Close((HWND)data1);
  else if (_stricmp(subject, "Config") == 0)
    Config((HWND)data1);
  else if (_stricmp(subject, "Quit") == 0)
    Quit();
  else if (_stricmp(subject, "DoMenu") == 0) {
    LPSTR action = (LPSTR)data2;
    if (*action == 0)
      ret = 0;
    else {
      LPSTR string = strchr(action, ',');
      if (string) {
        *string = 0;
        string++;
      }
      else
        string = action;
  
      DoMenu((HMENU)data1, action, string);
    }
  }
  else if (_stricmp(subject, "DoAccel") == 0)
    *(PINT)data2 = DoAccel((LPSTR)data1);
  else if (_stricmp(subject, "DoRebar") == 0)
    DoRebar((HWND)data1);
  else
    ret = 0;

  return ret;
}

/********************
 * Message handlers *
 ********************/

void Setup() {
  hook = SetWindowsHookEx(WH_CALLWNDPROCRET, &HookProc, NULL, GetCurrentThreadId());

  nsCOMPtr<nsIPrefBranch> branch(do_GetService(NS_PREFSERVICE_CONTRACTID));
  if (branch != nsnull) {
    ReadAccelerator(branch, "extensions.adblockplus.settings_key", "adblockplus(Preferences)");
    ReadAccelerator(branch, "extensions.adblockplus.sidebar_key", "adblockplus(ListAll)");
    ReadAccelerator(branch, "extensions.adblockplus.enable_key", "adblockplus(ToggleEnabled)");
  }

  LoadImage();
}

void Quit() {
  if (hook)
    UnhookWindowsHookEx(hook);
}

void Create(HWND parent) {
  statusbarList.addStatusBar(parent);
  origWndProc = SubclassWindow(parent, &WndProc);
}

void Close(HWND parent) {
  toolbarList.removeWindow(parent);
  statusbarList.removeStatusBar(parent);
}

void Config(HWND parent) {
  WndProc(parent, WM_COMMAND, cmdBase + CMD_PREFERENCES, 0);
}

void DoMenu(HMENU menu, LPSTR action, LPSTR string) {
  UINT command = CommandByName(action);
  if (command >= 0)
    AppendMenuA(menu, MF_STRING, cmdBase + command, string);
}

INT DoAccel(LPSTR action) {
  UINT command = CommandByName(action);
  if (command >= 0)
    return cmdBase + command;

  return 0;
}

void DoRebar(HWND hRebar) {
  DWORD dwStyle = CCS_NODIVIDER | CCS_NOPARENTALIGN | CCS_NORESIZE |
    TBSTYLE_FLAT | TBSTYLE_TRANSPARENT | TBSTYLE_TOOLTIPS;

  HWND toolbar = kFuncs->CreateToolbar(GetParent(hRebar), dwStyle);
  if (!toolbar)
    return;

  TBBUTTON button = {0};
  button.iBitmap = 0;
  button.idCommand = cmdBase + CMD_TOOLBAR;
  button.fsState = TBSTATE_ENABLED;
  button.fsStyle = TBSTYLE_BUTTON;
  button.dwData = 0;
  button.iString = -1;

  SendMessage(toolbar, TB_BUTTONSTRUCTSIZE, (WPARAM)sizeof(button), 0);
  SendMessage(toolbar, TB_ADDBUTTONS, 1, (LPARAM)&button);

  int width, height;
  ImageList_GetIconSize(hImages, &width, &height);
  SendMessage(toolbar, TB_SETBUTTONSIZE, 0, (LPARAM)MAKELONG(width, height));
  SendMessage(toolbar, TB_SETIMAGELIST, 0, (LPARAM)hImages);

  DWORD dwBtnSize = SendMessage(toolbar, TB_GETBUTTONSIZE, 0, 0); 
  width = LOWORD(dwBtnSize);
  height = HIWORD(dwBtnSize);

  kFuncs->RegisterBand(toolbar, "Adblock Plus", TRUE);

  REBARBANDINFO rebar = {0};
  rebar.cbSize = sizeof(rebar);
  rebar.fMask  = RBBIM_ID | RBBIM_STYLE | RBBIM_CHILD | RBBIM_CHILDSIZE | RBBIM_SIZE | RBBIM_IDEALSIZE;
  rebar.wID = 'AB';
  rebar.fStyle = RBBS_CHILDEDGE | RBBS_FIXEDBMP;
  rebar.hwndChild  = toolbar;
  rebar.cxMinChild = width;
  rebar.cyMinChild = height;
  rebar.cyMaxChild = height;
  rebar.cxIdeal    = width;
  rebar.cx         = width;
  SendMessage(hRebar, RB_INSERTBAND, (WPARAM)-1, (LPARAM)&rebar);

  toolbarList.addToolbar(toolbar, hRebar);
}

/********************
 * Helper functions *
 ********************/

void ReadAccelerator(nsIPrefBranch* branch, const char* pref, const char* command) {
  PRBool control = PR_FALSE;
  PRBool alt = PR_FALSE;
  PRBool shift = PR_FALSE;
  PRBool virt = PR_FALSE;
  char* key = nsnull;
  char buf[256] = "";

  char* part;
  char* next;
  nsresult rv = branch->GetCharPref(pref, &part);
  if (NS_FAILED(rv))
    return;

  for (char* c = part; *c; c++)
    if (*c >= 'a' && *c <= 'z')
      *c -= 'a' - 'A';

  while (part) {
    next = strchr(part, ' ');
    if (next)
      *next++ = 0;

    if (((part[0] >= 'A' && part[0] <= 'Z') || (part[0] >= '0' && part[0] <= '9')) && part[1] == 0) {
      key = part;
      virt = PR_FALSE;
    }
    else if (strcmp(part, "ACCEL") == 0 || strcmp(part, "CONTROL") == 0 || strcmp(part, "CTRL") == 0)
      control = PR_TRUE;
    else if (strcmp(part, "ALT") == 0)
      alt = PR_TRUE;
    else if (strcmp(part, "SHIFT") == 0)
      shift = PR_TRUE;
    else {
      int num = 0;
      int valid = 0;
      for (char* c = part; *c; c++,num++)
        if ((*c >= 'A' && *c <= 'Z') || (*c >= '0' && *c <= '9') || *c == '_')
          valid++;

      if (num > 1 && valid == num) {
        key = part;
        virt = PR_TRUE;
      }
    }
    part = next;
  }

  if (key != nsnull) {
    if (control)
      strcat_s(buf, sizeof buf, "CTRL ");
    if (alt)
      strcat_s(buf, sizeof buf, "ALT ");
    if (shift)
      strcat_s(buf, sizeof buf, "SHIFT ");
    if (virt)
      strcat_s(buf, sizeof buf, "VK_");
  
    strcat_s(buf, sizeof buf, key);

    strcat_s(buf, sizeof buf, " = ");
    strcat_s(buf, sizeof buf, command);
  
    kFuncs->ParseAccel(buf);
  }
}

void LoadImage()
{
  nsresult rv;

  nsCOMPtr<imgILoader> loader = do_GetService("@mozilla.org/image/loader;1");
  nsCOMPtr<nsIIOService> ioService = do_GetService("@mozilla.org/network/io-service;1");
  if (loader == nsnull || ioService == nsnull)
    return;

  nsCOMPtr<nsIURI> uri;
  nsCString urlStr(imagesURL);
  rv = ioService->NewURI(urlStr, nsnull, nsnull, getter_AddRefs(uri));
  if (NS_FAILED(rv))
    return;

  nsCOMPtr<imgIRequest> retval;
  rv = loader->LoadImage(uri, nsnull, nsnull, nsnull, imgObserver, nsnull,
                         nsIRequest::LOAD_NORMAL, nsnull, nsnull, getter_AddRefs(imageRequest));
  if (NS_FAILED(rv))
    return;

  return;
}

void DoneLoadingImage()
{
  toolbarList.invalidateToolbars();
  statusbarList.invalidateStatusBars();
}

INT CommandByName(LPCSTR action) {
  INT command = -1;
  if (_stricmp(action, "Preferences") == 0)
    command = CMD_PREFERENCES;
  else if (_stricmp(action, "ListAll") == 0)
    command = CMD_LISTALL;
  else if (_stricmp(action, "ToggleEnabled") == 0)
    command = CMD_TOGGLEENABLED;

  return command;
}
