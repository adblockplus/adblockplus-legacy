#!/usr/bin/perl

use strict;
use warnings;
use lib qw(buildtools);

$0 =~ s/(.*[\\\/])//g;
chdir($1) if $1;

system("hg", "clone", "https://hg.adblockplus.org/buildtools/") unless -e "buildtools";

require LocaleTester;

my %paths = (
  abp => 'chrome/locale',
  ehh => '../elemhidehelper/chrome/locale',
);

my @mustDiffer = (
  ['abp:overlay:opensidebar.accesskey', 'abp:overlay:settings.accesskey', 'abp:settings:options.accesskey', 'abp:settings:enable.accesskey', 'ehh:overlay:selectelement.accesskey'],
  ['abp:settings:filters.accesskey', 'abp:settings:edit.accesskey', 'abp:settings:view.accesskey', 'abp:settings:options.accesskey', 'abp:settings:help.accesskey', 'abp:settings:add.accesskey', 'abp:settings:apply.accesskey'],
  ['abp:settings:add.accesskey', 'abp:settings:addsubscription.accesskey', 'abp:settings:synchsubscriptions.accesskey', 'abp:settings:import.accesskey', 'abp:settings:export.accesskey', 'abp:settings:clearall.accesskey', 'abp:settings:resethitcounts.accesskey'],
  ['abp:settings:cut.accesskey', 'abp:settings:copy.accesskey', 'abp:settings:paste.accesskey', 'abp:settings:remove.accesskey', 'abp:settings:menu.find.accesskey', 'abp:settings:menu.findagain.accesskey'],
  ['abp:settings:filter.accesskey', 'abp:settings:slow.accesskey', 'abp:settings:enabled.accesskey', 'abp:settings:hitcount.accesskey', 'abp:settings:lasthit.accesskey', 'abp:settings:sort.accesskey'],
  ['abp:settings:sort.none.accesskey', 'abp:settings:filter.accesskey', 'abp:settings:slow.accesskey', 'abp:settings:enabled.accesskey', 'abp:settings:hitcount.accesskey', 'abp:settings:lasthit.accesskey', 'abp:settings:sort.ascending.accesskey', 'abp:settings:sort.descending.accesskey'],
  ['abp:settings:enable.accesskey', 'abp:settings:showintoolbar.accesskey', 'abp:settings:showinstatusbar.accesskey', 'abp:settings:objecttabs.accesskey', 'abp:settings:collapse.accesskey'],
  ['abp:settings:gettingStarted.accesskey', 'abp:settings:faq.accesskey', 'abp:settings:filterdoc.accesskey', 'abp:settings:about.accesskey'],
  ['abp:subscriptionSelection:other.accesskey', 'abp:subscriptionSelection:title.accesskey', 'abp:subscriptionSelection:location.accesskey', 'abp:subscriptionSelection:autodownload.accesskey', 'abp:subscriptionSelection:addMain.accesskey'],
  ['abp:composer:filter.accesskey', 'abp:composer:preferences.accesskey', 'abp:composer:type.filter.accesskey', 'abp:composer:type.whitelist.accesskey', 'abp:composer:custom.pattern.accesskey', 'abp:composer:anchor.start.accesskey', 'abp:composer:anchor.end.accesskey', 'abp:composer:domainRestriction.accesskey', 'abp:composer:firstParty.accesskey', 'abp:composer:thirdParty.accesskey', 'abp:composer:matchCase.accesskey', 'abp:composer:collapse.accesskey'],
  ['ehh:global:command.select.key', 'ehh:global:command.wider.key', 'ehh:global:command.narrower.key', 'ehh:global:command.quit.key', 'ehh:global:command.blinkElement.key', 'ehh:global:command.viewSource.key', 'ehh:global:command.viewSourceWindow.key', 'ehh:global:command.showMenu.key'],
);

my @mustEqual = (
  ['abp:overlay:opensidebar.accesskey', 'abp:overlay:closesidebar.accesskey'],
  ['abp:composer:anchor.start.accesskey', 'abp:composer:anchor.start.flexible.accesskey'],
  ['ehh:overlay:selectelement.accesskey', 'ehh:overlay:stopselection.accesskey'],
);

my @ignoreUntranslated = (
  qr/\.url$/,
  quotemeta("abp:about:caption.title"),
  quotemeta("abp:about:version.title"),
  quotemeta("abp:global:default_dialog_title"),
  quotemeta("abp:global:status_active_label"),
  quotemeta("abp:global:type_label_document"),
  quotemeta("abp:global:type_label_dtd"),
  quotemeta("abp:global:type_label_ping"),
  quotemeta("abp:global:type_label_script"),
  quotemeta("abp:global:type_label_stylesheet"),
  quotemeta("abp:global:type_label_xbl"),
  quotemeta("abp:global:subscription_status"),
  quotemeta("abp:global:subscription_status_lastdownload_unknown"),
  quotemeta("abp:overlay:status.tooltip"),
  quotemeta("abp:overlay:toolbarbutton.label"),
  quotemeta("abp:settings:filters.label"),
  quotemeta("abp:sidebar:filter.label"),
  quotemeta("abp:meta:name"),
  quotemeta("abp:meta:homepage"),
  quotemeta("ehh:composer:nodes-tree.class.label"),
  quotemeta("ehh:composer:nodes-tree.id.label"),
  quotemeta("ehh:global:noabp_warning_title"),
  quotemeta("ehh:meta:name"),
);

my %lengthRestrictions = (
  'abp:meta:description.short' => 250,
  'ehh:meta:description.short' => 250,
);
 
LocaleTester::testLocales(
  paths => \%paths,
  locales => \@ARGV,
  mustDiffer => \@mustDiffer,
  mustEqual => \@mustEqual,
  ignoreUntranslated => \@ignoreUntranslated,
  lengthRestrictions => \%lengthRestrictions,
);
