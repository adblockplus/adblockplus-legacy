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

BOOL APIENTRY DllMain(HINSTANCE hinstDLL, DWORD fdwReason, LPVOID lpvReserved) {
  return TRUE;
}

/**********************
 * K-Meleon callbacks *
 **********************/

LONG abpWrapper::DoMessage(LPCSTR to, LPCSTR from, LPCSTR subject, LONG data1, LONG data2)
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

PRBool abpWrapper::Load() {
  nsresult rv;

  kFuncs = kPlugin.kFuncs;

  abpJSContextHolder contextHolder;
  JSContext* cx = contextHolder.get();
  if (cx == nsnull)
    return PR_FALSE;

#ifndef TOOLKIT_ONLY
  nsCOMPtr<nsIChromeRegistrySea> registry = do_GetService("@mozilla.org/chrome/chrome-registry;1");
  if (registry) {
    // If we got the SeaMonkey registry this is probably K-Meleon 1.0, skip registration for K-Meleon 1.1

    rv = registry->InstallPackage("jar:resource:/chrome/adblockplus.jar!/content/", PR_FALSE);
    if (NS_FAILED(rv)) {
      JS_ReportError(cx, "Adblock Plus: Failed to register Adblock Plus chrome content");
      return PR_FALSE;
    }

    rv = registry->InstallLocale("jar:resource:/chrome/adblockplus.jar!/locale/" ABP_LANGUAGE "/", PR_FALSE);
    if (NS_FAILED(rv)) {
      JS_ReportError(cx, "Adblock Plus: Failed to register Adblock Plus locale");
      return PR_FALSE;
    }

    rv = registry->InstallSkin("jar:resource:/chrome/adblockplus.jar!/skin/classic/", PR_FALSE, PR_TRUE);
    if (NS_FAILED(rv)) {
      JS_ReportError(cx, "Adblock Plus: Failed to register Adblock Plus skin");
      return PR_FALSE;
    }

    rv = registry->SelectLocaleForPackage(NS_LITERAL_CSTRING(ABP_LANGUAGE), NS_LL("adblockplus"), PR_FALSE);
    if (NS_FAILED(rv)) {
      JS_ReportError(cx, "Adblock Plus: Failed to select Adblock Plus locale");
      return PR_FALSE;
    }

    rv = registry->SelectSkinForPackage(NS_LITERAL_CSTRING("classic/1.0"), NS_LL("adblockplus"), PR_FALSE);
    if (NS_FAILED(rv)) {
      JS_ReportError(cx, "Adblock Plus: Failed to select Adblock Plus skin");
      return PR_FALSE;
    }
  }
#endif

  watcher = do_GetService(NS_WINDOWWATCHER_CONTRACTID);
  if (watcher == nsnull) {
    JS_ReportError(cx, "Adblock Plus: Failed to retrieve window watcher - wrong Gecko version?");
    return PR_FALSE;
  }

  ioService = do_GetService("@mozilla.org/network/io-service;1");
  if (ioService == nsnull) {
    JS_ReportError(cx, "Adblock Plus: Failed to retrieve IO service - wrong Gecko version?");
    return PR_FALSE;
  }

  if (!PatchComponent(cx))
    return PR_FALSE;

  cmdBase = kFuncs->GetCommandIDs(NUM_COMMANDS);
  toolbarList.init(cmdBase + CMD_TOOLBAR);
  statusbarList.init(hImages, cmdBase + CMD_STATUSBAR, kFuncs->AddStatusBarIcon, kFuncs->RemoveStatusBarIcon);

  return PR_TRUE;
}

void abpWrapper::Setup() {
  hook = SetWindowsHookEx(WH_CALLWNDPROCRET, &HookProc, NULL, GetCurrentThreadId());

  nsCOMPtr<nsIPrefBranch> branch(do_GetService(NS_PREFSERVICE_CONTRACTID));
  if (branch != nsnull) {
    ReadAccelerator(branch, "extensions.adblockplus.settings_key", "adblockplus(Preferences)");
    ReadAccelerator(branch, "extensions.adblockplus.sidebar_key", "adblockplus(ListAll)");
    ReadAccelerator(branch, "extensions.adblockplus.enable_key", "adblockplus(ToggleEnabled)");
  }

  wrapper->LoadImage(0);
}

void abpWrapper::Quit() {
  if (hook)
    UnhookWindowsHookEx(hook);
}

void abpWrapper::Create(HWND parent) {
  statusbarList.addStatusBar(parent);
  origWndProc = SubclassWindow(parent, &WndProc);
}

void abpWrapper::Close(HWND parent) {
  toolbarList.removeWindow(parent);
  statusbarList.removeStatusBar(parent);
}

void abpWrapper::Config(HWND parent) {
  WndProc(parent, WM_COMMAND, cmdBase + CMD_PREFERENCES, 0);
}

void abpWrapper::DoMenu(HMENU menu, LPSTR action, LPSTR string) {
  UINT command = CommandByName(action);
  if (command >= 0)
    AppendMenuA(menu, MF_STRING, cmdBase + command, string);
}

INT abpWrapper::DoAccel(LPSTR action) {
  UINT command = CommandByName(action);
  if (command >= 0)
    return cmdBase + command;

  return 0;
}

void abpWrapper::DoRebar(HWND hRebar) {
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

/**********************
 * Window procedures  *
 **********************/

LRESULT CALLBACK WndProc(HWND hWnd, UINT message, WPARAM wParam, LPARAM lParam) {
  if (message == WM_COMMAND) {
    WORD command = LOWORD(wParam) - cmdBase;
    char* commandName;
    PRBool done = PR_TRUE;
    switch (command) {
      case CMD_PREFERENCES:
        commandName = "settings";
        break;
      case CMD_LISTALL:
        commandName = "blockable";
        break;
      case CMD_TOGGLEENABLED:
        commandName = "enable";
        break;
      case CMD_IMAGE:
        commandName = "image";
        break;
      case CMD_OBJECT:
        commandName = "object";
        break;
      case CMD_LINK:
        commandName = "link";
        break;
      case CMD_FRAME:
        commandName = "frame";
        break;
      case CMD_TOOLBAR:
        commandName = "toolbar";
        break;
      case CMD_STATUSBAR:
        commandName = "statusbar";
        break;
      default:
        commandName = "menu";
        done = PR_FALSE;
        break;
    }

    abpJSContextHolder holder;
    JSObject* overlay = UnwrapJSObject(fakeBrowserWindow);
    JSContext* cx = holder.get();
    if (cx != nsnull && overlay != nsnull) {
      JSString* str = JS_NewStringCopyZ(cx, commandName);
      if (str != nsnull) {
        jsval retval;
        jsval args[] = {STRING_TO_JSVAL(str), INT_TO_JSVAL(hWnd), INT_TO_JSVAL(LOWORD(wParam))};
        JS_CallFunctionName(cx, overlay, "onCommand", 3, args, &retval);
      }
    }
    if (done)
      return TRUE;
  }
  else if (((message == TB_MBUTTONDOWN || message == TB_MBUTTONDBLCLK) && wParam == cmdBase + CMD_TOOLBAR) ||
           ((message == SB_MBUTTONDOWN || message == SB_MBUTTONDBLCLK) && wParam == cmdBase + CMD_STATUSBAR)) {
    abpJSContextHolder holder;
    char param[] = "enable";
    JSObject* overlay = UnwrapJSObject(fakeBrowserWindow);
    JSContext* cx = holder.get();
    if (cx != nsnull && overlay != nsnull) {
      JSString* str = JS_NewString(cx, param, strlen(param));
      if (str != nsnull) {
        jsval arg = STRING_TO_JSVAL(str);
        jsval retval;
        JS_CallFunctionName(cx, overlay, "onCommand", 1, &arg, &retval);
      }
    }
  }
  else if ((message == TB_RBUTTONDOWN && wParam == cmdBase + CMD_TOOLBAR) ||
           (message == SB_RBUTTONDOWN && wParam == cmdBase + CMD_STATUSBAR)) {
    showContextMenu(hWnd, message != TB_RBUTTONDOWN);
  }
  else if (message == WM_NOTIFY) {
    LPNMHDR notifyHeader = (LPNMHDR) lParam;
    if (notifyHeader->code == (UINT)TTN_NEEDTEXT && (wParam == cmdBase + CMD_TOOLBAR || wParam == cmdBase + CMD_STATUSBAR)) {
      abpJSContextHolder holder;
      JSObject* overlay = UnwrapJSObject(fakeBrowserWindow);
      JSContext* cx = holder.get();
      if (cx != nsnull && overlay != nsnull) {
        jsval arg = (wParam == cmdBase + CMD_STATUSBAR ? JSVAL_TRUE : JSVAL_FALSE);
        jsval retval;
        if (JS_CallFunctionName(cx, overlay, "getTooltipText", 1, &arg, &retval)) {
          JSString* text = JS_ValueToString(cx, retval);
          LPTOOLTIPTEXT lpTiptext = (LPTOOLTIPTEXT) lParam;
          lpTiptext->lpszText = JS_GetStringBytes(text);
          return 0;
        }
      }
    }
  }

  if (IsWindowUnicode(hWnd))
    return CallWindowProcW(origWndProc, hWnd, message, wParam, lParam);
  else
    return CallWindowProcA(origWndProc, hWnd, message, wParam, lParam);
}

LRESULT CALLBACK DialogWndProc(HWND hWnd, UINT message, WPARAM wParam, LPARAM lParam) {
  LRESULT retVal;
  if (IsWindowUnicode(hWnd))
    retVal = CallWindowProcW(origDialogWndProc, hWnd, message, wParam, lParam);
  else
    retVal = CallWindowProcA(origDialogWndProc, hWnd, message, wParam, lParam);

  char* eventHandler;
  switch (message) {
    case WM_SIZE:
      eventHandler = "onDialogResize";
      break;
    case WM_MOVE:
      eventHandler = "onDialogMove";
      break;
    default:
      eventHandler = nsnull;
      break;
  }

  if (eventHandler) {
    abpJSContextHolder holder;
    JSObject* overlay = UnwrapJSObject(fakeBrowserWindow);
    if (holder.get() && overlay) {
      jsval retval;
      jsval arg = INT_TO_JSVAL((int32)hWnd);

      JS_CallFunctionName(holder.get(), overlay, eventHandler, 1, &arg, &retval);
    }
  }

  return retVal;
}

LRESULT CALLBACK HookProc(int nCode, WPARAM wParam, LPARAM lParam) {
  if (nCode == HC_ACTION) {
    CWPRETSTRUCT* params = (CWPRETSTRUCT*)lParam;
    if (params->message == WM_DRAWITEM) {
      DRAWITEMSTRUCT* dis = (DRAWITEMSTRUCT*)params->lParam;
      WORD id = dis->itemID - cmdBase;
      if (dis->CtlType == ODT_MENU && id < NUM_COMMANDS)
        ImageList_Draw(hImages, 0, dis->hDC, dis->rcItem.left + 1, dis->rcItem.top + 1, ILD_TRANSPARENT);
    }
  }

  return CallNextHookEx(hook, nCode, wParam, lParam);
}

/******************************
 * nsISupports implementation *
 ******************************/

NS_IMPL_ISUPPORTS3(abpWrapper, nsIDOMEventListener, imgIDecoderObserver, nsIXPCScriptable)

/**************************************
 * nsIDOMEventListener implementation *
 **************************************/

nsresult abpWrapper::HandleEvent(nsIDOMEvent* event) {
  nsresult rv;

  abpJSContextHolder holder;
  JSObject* overlay = UnwrapJSObject(fakeBrowserWindow);
  JSContext* cx = holder.get();
  if (cx == nsnull || overlay == nsnull)
    return NS_ERROR_FAILURE;

  nsCOMPtr<nsIXPConnect> xpc = do_GetService(nsIXPConnect::GetCID());
  if (xpc == nsnull)
    return NS_ERROR_FAILURE;

  nsCOMPtr<nsIXPConnectJSObjectHolder> wrapperHolder;
  rv = xpc->WrapNative(cx, JS_GetParent(cx, overlay), event, NS_GET_IID(nsIDOMEvent), getter_AddRefs(wrapperHolder));
  if (NS_FAILED(rv))
    return rv;

  JSObject* jsObj;
  rv = wrapperHolder->GetJSObject(&jsObj);
  if (NS_FAILED(rv))
    return rv;

  jsval arg = OBJECT_TO_JSVAL(jsObj);
  jsval retval;  
  JS_CallFunctionName(cx, overlay, "onEvent", 1, &arg, &retval);

  return NS_OK;
}

/**************************************
 * imgIDecoderObserver implementation *
 **************************************/

nsresult abpWrapper::OnStopFrame(imgIRequest* aRequest, gfxIImageFrame *aFrame) {
  nsresult rv;

  gfx_format format;
  rv = aFrame->GetFormat(&format);
  if (NS_FAILED(rv))
    return rv;

  if (format != gfxIFormats::BGR_A8)
    return NS_ERROR_FAILURE;

  PRInt32 width;
  rv = aFrame->GetWidth(&width);
  if (NS_FAILED(rv))
    return rv;

  PRInt32 height;
  rv = aFrame->GetHeight(&height);
  if (NS_FAILED(rv))
    return rv;

  PRUint32 imageBytesPerRow;
  rv = aFrame->GetImageBytesPerRow(&imageBytesPerRow);
  if (NS_FAILED(rv))
    return rv;

  PRUint8* imageBits;
  PRUint32 imageSize;
  rv = aFrame->GetImageData(&imageBits, &imageSize);
  if (NS_FAILED(rv))
    return rv;

  PRUint32 alphaBytesPerRow;
  rv = aFrame->GetAlphaBytesPerRow(&alphaBytesPerRow);
  if (NS_FAILED(rv))
    return rv;

  PRUint8* alphaBits;
  PRUint32 alphaSize;
  rv = aFrame->GetAlphaData(&alphaBits, &alphaSize);
  if (NS_FAILED(rv))
    return rv;

  HDC hDC = ::GetDC(NULL);

  PRUint8* bits = new PRUint8[imageSize + alphaSize];

  for (PRUint32 i = 0, j = 0, n = 0; i < imageSize && j < alphaSize && n < imageSize + alphaSize;) {
    bits[n++] = imageBits[i++];
    bits[n++] = imageBits[i++];
    bits[n++] = imageBits[i++];
    bits[n++] = alphaBits[j++];
  }

  BITMAPINFOHEADER head;
  head.biSize = sizeof(head);
  head.biWidth = width;
  head.biHeight = height;
  head.biPlanes = 1;
  head.biBitCount = 32;
  head.biCompression = BI_RGB;
  head.biSizeImage = imageSize + alphaSize;
  head.biXPelsPerMeter = 0;
  head.biYPelsPerMeter = 0;
  head.biClrUsed = 0;
  head.biClrImportant = 0;

  HBITMAP image = ::CreateDIBitmap(hDC, NS_REINTERPRET_CAST(CONST BITMAPINFOHEADER*, &head),
                                   CBM_INIT, bits, NS_REINTERPRET_CAST(CONST BITMAPINFO*, &head),
                                   DIB_RGB_COLORS);
  delete bits;

  ImageList_Add(hImages, image, NULL);
  DeleteObject(image);

  ReleaseDC(NULL, hDC);

  return NS_OK;
}

nsresult abpWrapper::OnStartDecode(imgIRequest* aRequest) {
  return NS_OK;
}
nsresult abpWrapper::OnStartContainer(imgIRequest* aRequest, imgIContainer *aContainer) {
  return NS_OK;
}
nsresult abpWrapper::OnStartFrame(imgIRequest* aRequest, gfxIImageFrame *aFrame) {
  return NS_OK;
}
nsresult abpWrapper::OnDataAvailable(imgIRequest *aRequest, gfxIImageFrame *aFrame, const nsIntRect * aRect) {
  return NS_OK;
}
nsresult abpWrapper::OnStopContainer(imgIRequest* aRequest, imgIContainer *aContainer) {
  return NS_OK;
}
nsresult abpWrapper::OnStopDecode(imgIRequest* aRequest, nsresult status, const PRUnichar *statusArg) {
  LoadImage(currentImage + 1);
  return NS_OK;
}
nsresult abpWrapper::FrameChanged(imgIContainer *aContainer, gfxIImageFrame *aFrame, nsIntRect * aDirtyRect) {
  return NS_OK;
}

/**************************
 * JS object manupulation *
 **************************/

PRBool abpWrapper::PatchComponent(JSContext* cx) {
  nsresult rv;

  nsCOMPtr<nsIScriptSecurityManager> secman = do_GetService(NS_SCRIPTSECURITYMANAGER_CONTRACTID);
  if (secman == nsnull) {
    JS_ReportError(cx, "Adblock Plus: Failed to retrieve security manager - wrong Gecko version?");
    return PR_FALSE;
  }

  rv = secman->GetSystemPrincipal(getter_AddRefs(systemPrincipal));
  if (NS_FAILED(rv) || systemPrincipal == nsnull) {
    JS_ReportError(cx, "Adblock Plus: Failed to retrieve system's security principal");
    return PR_FALSE;
  }

  nsCOMPtr<nsISupports> abp = do_CreateInstance(ADBLOCKPLUS_CONTRACTID);
  if (abp == nsnull) {
    // Maybe the component isn't registered yet? Try registering it.
    nsCOMPtr<nsIComponentRegistrar> compReg;
    rv = NS_GetComponentRegistrar(getter_AddRefs(compReg));
    if (NS_FAILED(rv) || compReg == nsnull) {
      JS_ReportError(cx, "Adblock Plus: Failed to retrieve component registrar - wrong Gecko version?");
      return PR_FALSE;
    }

    nsCOMPtr<nsIProperties> dirService = do_GetService("@mozilla.org/file/directory_service;1");
    if (dirService == nsnull) {
      JS_ReportError(cx, "Adblock Plus: Failed to retrieve directory service - wrong Gecko version?");
      return PR_FALSE;
    }

    nsCOMPtr<nsILocalFile> compFile;
    rv = dirService->Get(NS_XPCOM_COMPONENT_DIR, NS_GET_IID(nsILocalFile), getter_AddRefs(compFile));
    if (NS_FAILED(rv)) {
      JS_ReportError(cx, "Adblock Plus: Failed to retrieve components directory");
      return PR_FALSE;
    }

    compFile->AppendRelativePath(NS_LITERAL_STRING("nsAdblockPlus.js"));
    rv = compReg->AutoRegister(compFile);
    if (NS_FAILED(rv)) {
      JS_ReportError(cx, "Adblock Plus: Failed to register nsAdblockPlus.js");
      return PR_FALSE;
    }

    abp = do_CreateInstance(ADBLOCKPLUS_CONTRACTID);
  }
  if (abp == nsnull) {
    JS_ReportError(cx, "Adblock Plus: Failed to retrieve Adblock Plus component");
    return PR_FALSE;
  }

  JSObject* jsObject = UnwrapJSObject(abp);
  if (jsObject == nsnull) {
    JS_ReportError(cx, "Adblock Plus: Failed extracting JavaScript object from Adblock Plus component");
    return PR_FALSE;
  }

  if (!CreateFakeBrowserWindow(cx, JS_GetParent(cx, jsObject)))
    return PR_FALSE;

  return PR_TRUE;
}

PRBool abpWrapper::CreateFakeBrowserWindow(JSContext* cx, JSObject* parent) {
  nsresult rv;
  jsval value;

  JSObject* obj = JS_NewObject(cx, nsnull, nsnull, parent);
  if (obj == nsnull) {
    JS_ReportError(cx, "Adblock Plus: Failed to create fake browser window object - out of memory?");
    return PR_FALSE;
  }
  JS_SetGlobalObject(cx, obj);

  if (!JS_DefineFunctions(cx, obj, window_methods)) {
    JS_ReportError(cx, "Adblock Plus: Failed to attach native methods to fake browser window");
    return PR_FALSE;
  }

  if (!JS_DefineProperties(cx, obj, window_properties)) {
    JS_ReportError(cx, "Adblock Plus: Failed to attach native properties to fake browser window");
    return PR_FALSE;
  }

  JSPrincipals* principals;
  rv = systemPrincipal->GetJSPrincipals(cx, &principals);
  if (NS_FAILED(rv)) {
    JS_ReportError(cx, "Adblock Plus: Could not convert system principal into JavaScript principals");
    return PR_FALSE;
  }

  for (int i = 0; includes[i]; i += 2) {
    JSScript* inlineScript = JS_CompileScriptForPrincipals(cx, obj, principals, includes[i+1], strlen(includes[i+1]), includes[i], 1);
    if (inlineScript == nsnull) {
      JS_ReportError(cx, "Adblock Plus: Failed to compile %s", includes[i]);
      return PR_FALSE;
    }

    if (!JS_ExecuteScript(cx, obj, inlineScript, &value)) {
      JS_ReportError(cx, "Adblock Plus: Failed to execute %s", includes[i]);
      return PR_FALSE;
    }
    JS_DestroyScript(cx, inlineScript);
  }
  JSPRINCIPALS_DROP(cx, principals);

  nsCOMPtr<nsIXPConnect> xpc = do_GetService(nsIXPConnect::GetCID());
  if (xpc == nsnull) {
    JS_ReportError(cx, "Adblock Plus: Coult not retrieve nsIXPConnect - wrong Gecko version?");
    return PR_FALSE;
  }

  nsCOMPtr<nsISupports> wrapped;
  rv = xpc->WrapJS(cx, obj, NS_GET_IID(nsISupports), getter_AddRefs(wrapped));
  if (NS_FAILED(rv)) {
    JS_ReportError(cx, "Adblock Plus: Failed to create XPConnect wrapper for fake browser window");
    return PR_FALSE;
  }

  fakeBrowserWindow = do_QueryInterface(wrapped);
  if (fakeBrowserWindow == nsnull) {
    JS_ReportError(cx, "Adblock Plus: Failed to QI fake browser window");
    return PR_FALSE;
  }

  jsval readerVal;
  JS_GetProperty(cx, obj, "_dtdReader", &readerVal);
  if (readerVal == JSVAL_VOID) {
    JS_ReportError(cx, "Adblock Plus: Failed to retrieve DTD reader object");
    return PR_FALSE;
  }

  JSObject* reader = JSVAL_TO_OBJECT(readerVal);
  for (int i = 0; i < NUM_LABELS; i++) {
    JSString* str = JS_NewStringCopyZ(cx, context_labels[i]);
    if (str == nsnull) {
      JS_ReportError(cx, "Adblock Plus: Could not create JavaScript string for '%s' - out of memory?", context_labels[i]);
      return PR_FALSE;
    }

    jsval args[] = {STRING_TO_JSVAL(str)};
    jsval retval;
    if (!JS_CallFunctionName(cx, reader, "getEntity", 1, args, &retval)) {
      JS_ReportError(cx, "Adblock Plus: Failed to retrieve entity '%s' from overlay.dtd", context_labels[i]);
      return PR_FALSE;
    }

    str = JS_ValueToString(cx, retval);
    if (str == nsnull) {
      JS_ReportError(cx, "Adblock Plus: Could not convert return value of _dtdReader.getEntity() to string");
      return PR_FALSE;
    }

    strcpy_s(labelValues[i], sizeof(labelValues[i]), JS_GetStringBytes(str));
  }

  return PR_TRUE;
}

JSObject* UnwrapJSObject(nsISupports* native) {
  nsCOMPtr<nsIXPConnectWrappedJS> holder = do_QueryInterface(native);
  if (holder == nsnull)
    return nsnull;

  JSObject* innerObj;
  nsresult rv = holder->GetJSObject(&innerObj);
  if (NS_FAILED(rv))
    return nsnull;

  return innerObj;
}

nsISupports* UnwrapNative(JSContext* cx, JSObject* obj) {
  nsresult rv;

  nsCOMPtr<nsIXPConnect> xpc = do_GetService(nsIXPConnect::GetCID());
  if (xpc == nsnull)
    return nsnull;

  nsCOMPtr<nsIXPConnectWrappedNative> wrapped;
  rv = xpc->GetWrappedNativeOfJSObject(cx, obj, getter_AddRefs(wrapped));
  if (NS_FAILED(rv))
    return nsnull;

  nsCOMPtr<nsISupports> native;
  rv = wrapped->GetNative(getter_AddRefs(native));
  if (NS_FAILED(rv))
    return nsnull;

  return native;
}



/********************
 * Helper functions *
 ********************/
 
INT abpWrapper::CommandByName(LPSTR action) {
  INT command = -1;
  if (_stricmp(action, "Preferences") == 0)
    command = CMD_PREFERENCES;
  else if (_stricmp(action, "ListAll") == 0)
    command = CMD_LISTALL;
  else if (_stricmp(action, "ToggleEnabled") == 0)
    command = CMD_TOGGLEENABLED;

  return command;
}

void abpWrapper::ReadAccelerator(nsIPrefBranch* branch, const char* pref, const char* command) {
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

JSObject* abpWrapper::GetGlobalObject(nsIDOMWindow* wnd) {
  nsCOMPtr<nsIScriptGlobalObject> global = do_QueryInterface(wnd);
  if (global == nsnull)
    return nsnull;

  return global->GetGlobalJSObject();
}

nsresult abpWrapper::OpenTab(const char* url, HWND hWnd) {
  nsresult rv = NS_OK;
  
  if (kFuncs->GetKmeleonVersion() >= 0x01050000)
  {
    if (hWnd)
      kFuncs->NavigateTo(url, OPEN_NEWTAB, GetTopWindow(hWnd));
    else
      kFuncs->NavigateTo(url, OPEN_NEW, NULL);
  }
  else
    kFuncs->SendMessage("layers", PLUGIN_NAME, "AddLayersToWindow", (LONG)"1", (LONG)url);

  return rv;
}

TCHAR* menus[] = {_T("DocumentPopup"), _T("DocumentImagePopup"), _T("TextPopup"),
                  _T("LinkPopup"), _T("ImageLinkPopup"), _T("ImagePopup"),
                  _T("FrameDocumentPopup"), _T("FrameDocumentImagePopup"), _T("FrameTextPopup"),
                  _T("FrameLinkPopup"), _T("FrameImageLinkPopup"), _T("FrameImagePopup"),
                  NULL};

void abpWrapper::AddContextMenuItem(WORD command, char* label) {
  MENUITEMINFO info = {0};
  info.cbSize = sizeof info;
  info.fMask = MIIM_TYPE;

  UINT drawFlag;
  for (int i = 0; menus[i]; i++) {
    HMENU hMenu = kFuncs->GetMenu(menus[i]);
    if (hMenu) {
      drawFlag = MF_OWNERDRAW;

      int count = GetMenuItemCount(hMenu);
      if (count > 0) {
        WORD id = GetMenuItemID(hMenu, count - 1) - cmdBase;
        if (id >= NUM_COMMANDS)
          AppendMenuA(hMenu, MF_SEPARATOR, cmdBase + CMD_SEPARATOR, NULL);

        // Only use MF_OWNERDRAW flag if other menu items have it as well
        if (GetMenuItemInfo(hMenu, 0, TRUE, &info) && !(info.fType & MFT_OWNERDRAW))
          drawFlag = MF_STRING;
      }
      AppendMenuA(hMenu, drawFlag, cmdBase + command, label);
    }
  }
}

void abpWrapper::ResetContextMenu() {
  for (int i = 0; menus[i]; i++) {
    HMENU hMenu = kFuncs->GetMenu(menus[i]);
    if (hMenu) {
      int count = GetMenuItemCount(hMenu);
      for (int j = 0; j < count; j++) {
        WORD id = GetMenuItemID(hMenu, j) - cmdBase;
        if (id < NUM_COMMANDS)
          RemoveMenu(hMenu, j--, MF_BYPOSITION);
      }
    }
  }
}

void showContextMenu(HWND hWnd, PRBool status) {
  abpJSContextHolder holder;
  JSObject* overlay = UnwrapJSObject(fakeBrowserWindow);
  JSContext* cx = holder.get();
  if (cx != nsnull && overlay != nsnull) {
    jsval arg = (status ? JSVAL_TRUE : JSVAL_FALSE);
    jsval retval;
    if (JS_CallFunctionName(cx, overlay, "buildContextMenu", 1, &arg, &retval)) {
      HMENU hMenu = NS_REINTERPRET_CAST(HMENU, JSVAL_TO_INT(retval));

      POINT pt;
      GetCursorPos(&pt);
      TrackPopupMenu(hMenu, TPM_LEFTALIGN, pt.x, pt.y, 0, hWnd, NULL);
    }
  }
}

void abpWrapper::LoadImage(int index) {
  nsresult rv;

  currentImage = index;
  if (currentImage >= sizeof(images)/sizeof(images[0])) {
    toolbarList.invalidateToolbars();
    statusbarList.invalidateStatusBars();
    return;
  }

  nsCOMPtr<imgILoader> loader = do_GetService("@mozilla.org/image/loader;1");
  if (loader == nsnull)
    return;

  nsCOMPtr<nsIURI> uri;
  nsCString urlStr(images[index]);
  rv = ioService->NewURI(urlStr, nsnull, nsnull, getter_AddRefs(uri));
  if (NS_FAILED(rv))
    return;

  nsCOMPtr<imgIRequest> retval;
  rv = loader->LoadImage(uri, nsnull, nsnull, nsnull, this, nsnull,
                         nsIRequest::LOAD_NORMAL, nsnull, nsnull, getter_AddRefs(imageRequest));
  if (NS_FAILED(rv))
    return;

  return;
}

WNDPROC abpWrapper::SubclassWindow(HWND hWnd, WNDPROC newWndProc) {
  WNDPROC origProc;
  if (IsWindowUnicode(hWnd)) {
    origProc = (WNDPROC)GetWindowLongW(hWnd, GWL_WNDPROC);
    SetWindowLongW(hWnd, GWL_WNDPROC, (LONG)newWndProc);
  }
  else {
    origProc = (WNDPROC)GetWindowLongA(hWnd, GWL_WNDPROC);
    SetWindowLongA(hWnd, GWL_WNDPROC, (LONG)newWndProc);
  }
  return origProc;
}
