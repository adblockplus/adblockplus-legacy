#!/usr/bin/perl

use strict;

my %paths = (
  abp => 'chrome/locale',
  ehh => 'elemhidehelper/chrome/locale',
);

my @must_differ = (
  ['abp:overlay:opensidebar.accesskey', 'abp:overlay:settings.accesskey', 'abp:settings:options.accesskey', 'abp:settings:enable.accesskey', 'ehh:overlay:selectelement.accesskey'],
  ['abp:settings:filters.accesskey', 'abp:settings:edit.accesskey', 'abp:settings:view.accesskey', 'abp:settings:options.accesskey', 'abp:settings:help.accesskey', 'abp:settings:add.accesskey', 'abp:settings:apply.accesskey'],
  ['abp:settings:add.accesskey', 'abp:settings:addsubscription.accesskey', 'abp:settings:synchsubscriptions.accesskey', 'abp:settings:import.accesskey', 'abp:settings:export.accesskey', 'abp:settings:clearall.accesskey', 'abp:settings:resethitcounts.accesskey'],
  ['abp:settings:cut.accesskey', 'abp:settings:copy.accesskey', 'abp:settings:paste.accesskey', 'abp:settings:remove.accesskey', 'abp:settings:menu.find.accesskey', 'abp:settings:menu.findagain.accesskey'],
  ['abp:settings:filter.accesskey', 'abp:settings:enabled.accesskey', 'abp:settings:hitcount.accesskey', 'abp:settings:lasthit.accesskey', 'abp:settings:sort.accesskey'],
  ['abp:settings:sort.none.accesskey', 'abp:settings:filter.accesskey', 'abp:settings:enabled.accesskey', 'abp:settings:hitcount.accesskey', 'abp:settings:lasthit.accesskey', 'abp:settings:sort.ascending.accesskey', 'abp:settings:sort.descending.accesskey'],
  ['abp:settings:enable.accesskey', 'abp:settings:showintoolbar.accesskey', 'abp:settings:showinstatusbar.accesskey', 'abp:settings:objecttabs.accesskey', 'abp:settings:collapse.accesskey'],
  ['abp:settings:faq.accesskey', 'abp:settings:tips.accesskey', 'abp:settings:filterdoc.accesskey', 'abp:settings:about.accesskey'],
  ['abp:findbar:findNext.accesskey', 'abp:findbar:findPrevious.accesskey', 'abp:findbar:highlight.accesskey', 'abp:findbar:caseSensitiveCheckbox.accesskey'],
  ['abp:subscription:location.accesskey', 'abp:subscription:title.accesskey', 'abp:subscription:autodownload.accesskey', 'abp:subscription:enabled.accesskey'],
  ['ehh:global:command.select.key', 'ehh:global:command.wider.key', 'ehh:global:command.narrower.key', 'ehh:global:command.quit.key', 'ehh:global:command.blinkElement.key', 'ehh:global:command.viewSource.key', 'ehh:global:command.viewSourceWindow.key', 'ehh:global:command.showMenu.key'],
);

my @must_equal = (
  ['abp:overlay:opensidebar.accesskey', 'abp:overlay:closesidebar.accesskey'],
  ['ehh:overlay:selectelement.accesskey', 'ehh:overlay:stopselection.accesskey'],
);

my @locales = sort {$a cmp $b} makeLocaleList();

foreach my $locale (@locales) {
  foreach my $entry (@must_differ) {
    my %values = ();
    foreach my $key (@$entry) {
      my $value = retrieveKey($locale, $key);
      next unless defined $value;
      $value = lc($value);

      print STDERR "$locale: values for $values{$value} and $key are identical, must differ\n" if exists $values{$value};
      $values{$value} = $key;
    }
  }

  foreach my $entry (@must_equal) {
    my $stdValue;
    my $stdName;
    foreach my $key (@$entry) {
      my $value = retrieveKey($locale, $key);
      next unless defined $value;
      $value = lc($value);

      $stdValue = $value unless defined $stdValue;
      $stdName = $key unless defined $stdName;
      print STDERR "$locale: values for $stdName and $key differ, must be equal\n" if $value ne $stdValue;
    }
  }
}

sub makeLocaleList
{
  my %locales = ();
  foreach my $dir (keys %paths) {
    opendir(local* DIR, $paths{$dir}) or die "Could not open directory $paths{$dir}";
    my @locales = grep {!/[^\w\-]/} readdir(DIR);
    $locales{$_} = 1 foreach @locales;
    closedir(DIR);
  }
  return keys %locales;
}

my %fileCache = ();
my $lastLocale;
sub retrieveKey
{
  my ($locale, $key) = @_;

  %fileCache = () unless $lastLocale eq $locale;
  $lastLocale = $locale;

  my @parts = split(/:/, $key);
  my $keyName = pop(@parts);
  my $fileName = join(':', @parts);
  readFile($locale, $fileName) unless exists $fileCache{$fileName};

  return undef unless exists $fileCache{$fileName};

  die "Key $key not found in locale $locale" unless exists $fileCache{$fileName}{$keyName};
  return $fileCache{$fileName}{$keyName};
}

sub readFile
{
  my ($locale, $file) = @_;

  my ($dir, $fileName) = split(/:/, $file, 2);

  die "Unknown directory $dir" unless exists $paths{$dir};
  $dir = $paths{$dir} . '/' . $locale;

  if (-f "$dir/$fileName.dtd")
  {
    readDTDFile($file, "$dir/$fileName.dtd");
  }
  elsif (-f "$dir/$fileName.properties")
  {
    readPropertiesFile($file, "$dir/$fileName.properties");
  }
}

sub readDTDFile
{
  my ($key, $file) = @_;
  
  my %result = ();

  open(local *FILE, $file) or die "Could not open file $file";
  local $/;
  my $data = <FILE>;
  close(FILE);

  while ($data =~ /<!ENTITY\s+(\S+)\s*"([^"]*)"/sg)
  {
    $result{$1} = $2;
  }

  $fileCache{$key} = \%result;
}

sub readPropertiesFile
{
  my ($key, $file) = @_;

  my %result = ();

  open(local *FILE, $file) or die "Could not open file $file";
  while (<FILE>)
  {
    s/[\r\n]//g;
    next if /^\s*#/;

    my ($key, $value) = split(/=/, $_, 2);
    $result{$key} = $value;
  }
  close(FILE);

  $fileCache{$key} = \%result;
}
