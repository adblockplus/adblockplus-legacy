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
  ['abp:settings:gettingStarted.accesskey', 'abp:settings:faq.accesskey', 'abp:settings:filterdoc.accesskey', 'abp:settings:about.accesskey'],
  ['abp:findbar:next.accesskey', 'abp:findbar:previous.accesskey', 'abp:findbar:highlight.accesskey'],
  ['abp:subscription:location.accesskey', 'abp:subscription:title.accesskey', 'abp:subscription:autodownload.accesskey', 'abp:subscription:enabled.accesskey'],
  ['abp:composer:filter.accesskey', 'abp:composer:preferences.accesskey', 'abp:composer:type.filter.accesskey', 'abp:composer:type.whitelist.accesskey', 'abp:composer:custom.pattern.accesskey', 'abp:composer:anchor.start.accesskey', 'abp:composer:anchor.end.accesskey', 'abp:composer:domainRestriction.accesskey', 'abp:composer:firstParty.accesskey', 'abp:composer:thirdParty.accesskey', 'abp:composer:matchCase.accesskey', 'abp:composer:collapse.accesskey'],
  ['ehh:global:command.select.key', 'ehh:global:command.wider.key', 'ehh:global:command.narrower.key', 'ehh:global:command.quit.key', 'ehh:global:command.blinkElement.key', 'ehh:global:command.viewSource.key', 'ehh:global:command.viewSourceWindow.key', 'ehh:global:command.showMenu.key'],
);

my @must_equal = (
  ['abp:overlay:opensidebar.accesskey', 'abp:overlay:closesidebar.accesskey'],
  ['ehh:overlay:selectelement.accesskey', 'ehh:overlay:stopselection.accesskey'],
);

my %keepAccessKeys = map {$_ => $_} (
  'ja-JP',
  'ko-KR',
  'zh-CN',
  'zh-TW',
);

my @ignoreUntranslated = (
  qr/\.url$/,
  quotemeta("abp:about:caption.title"),
  quotemeta("abp:about:version.title"),
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
  quotemeta("ehh:composer:nodes-tree.class.label"),
  quotemeta("ehh:composer:nodes-tree.id.label"),
  quotemeta("ehh:global:noabp_warning_title"),
);

my @locales = sort {$a cmp $b} makeLocaleList();

my $referenceLocale = readLocaleFiles("en-US");

foreach my $locale (@locales)
{
  my $currentLocale = $locale eq "en-US" ? $referenceLocale : readLocaleFiles($locale);

  compareLocales($locale, $currentLocale, $referenceLocale) unless $currentLocale == $referenceLocale;

  foreach my $entry (@must_differ)
  {
    my %values = ();
    foreach my $key (@$entry)
    {
      my ($dir, $file, $name) = split(/:/, $key);
      next unless exists($currentLocale->{"$dir:$file"}) && exists($currentLocale->{"$dir:$file"}{$name});
      my $value = lc($currentLocale->{"$dir:$file"}{$name});

      print "$locale: values for '$values{$value}' and '$key' are identical, must differ\n" if exists $values{$value};
      $values{$value} = $key;
    }
  }

  foreach my $entry (@must_equal)
  {
    my $stdValue;
    my $stdName;
    foreach my $key (@$entry)
    {
      my ($dir, $file, $name) = split(/:/, $key);
      next unless exists($currentLocale->{"$dir:$file"}) && exists($currentLocale->{"$dir:$file"}{$name});
      my $value = lc($currentLocale->{"$dir:$file"}{$name});

      $stdValue = $value unless defined $stdValue;
      $stdName = $key unless defined $stdName;
      print "$locale: values for '$stdName' and '$key' differ, must be equal\n" if $value ne $stdValue;
    }
  }

  foreach my $file (keys %$currentLocale)
  {
    my $fileData = $currentLocale->{$file};
    foreach my $key (keys %$fileData)
    {
      if (($key =~ /\.accesskey$/ || $key =~ /\.key$/) && length($fileData->{$key}) != 1)
      {
        print "$locale: Length of accesskey '$file:$key' isn't 1 character\n";
      }

      if ($key =~ /\.accesskey$/)
      {
        if (exists($keepAccessKeys{$locale}))
        {
          if (exists($referenceLocale->{$file}{$key}) && $fileData->{$key} ne $referenceLocale->{$file}{$key})
          {
            print "$locale: Accesskey '$file:$key' should be the same as in the reference locale\n";
          }
        }
        else
        {
          my $labelKey = $key;
          $labelKey =~ s/\.accesskey$/.label/;
          if (exists($fileData->{$labelKey}) && $fileData->{$labelKey} !~ /\Q$fileData->{$key}/i)
          {
            print "$locale: Accesskey '$file:$key' not found in the corresponding label '$file:$labelKey'\n";
          }
        }
      }

      if ($currentLocale != $referenceLocale && $locale ne "en-GB" && length($fileData->{$key}) > 1 && $fileData->{$key} eq $referenceLocale->{$file}{$key})
      {
        my $ignore = 0;
        foreach my $re (@ignoreUntranslated)
        {
          $ignore = 1 if "$file:$key" =~ $re;
        }
        print "$locale: Value of '$file:$key' is the same as in the reference locale, probably an untranslated string\n" unless $ignore;
      }
    }
  }
}

sub makeLocaleList
{
  return @ARGV if @ARGV;

  my %locales = ();
  foreach my $dir (keys %paths)
  {
    opendir(local* DIR, $paths{$dir}) or die "Could not open directory $paths{$dir}";
    my @locales = grep {!/[^\w\-]/ && !-e("$paths{$dir}/$_/.incomplete")} readdir(DIR);
    $locales{$_} = 1 foreach @locales;
    closedir(DIR);
  }
  return keys %locales;
}

sub readFile
{
  my $file = shift;

  open(local *FILE, "<", $file) || die "Could not read file '$file'";
  binmode(FILE);
  local $/;
  my $result = <FILE>;
  close(FILE);

  print "Byte Order Mark found in file '$file'\n" if $result =~ /\xEF\xBB\xBF/;
  print "File '$file' is not valid UTF-8\n" unless (utf8::decode($result));

  return $result;
}

sub parseDTDFile
{
  my $file = shift;
  
  my %result = ();

  my $data = readFile($file);

  my $S = qr/[\x20\x09\x0D\x0A]/;
  my $Name = qr/[A-Za-z_:][\w.\-:]*/;
  my $Reference = qr/&$Name;|&#\d+;|&#x[\da-fA-F]+;/;
  my $PEReference = qr/%$Name;/;
  my $EntityValue = qr/"((?:[^%&"]|$PEReference|$Reference)*)"|'((?:[^%&']|$PEReference|$Reference)*)'/;

  # Remove comments
  $data =~ s/<!--([^\-]|-[^\-])*-->//gs;

  # Process entities
  while ($data =~ /<!ENTITY$S+($Name)$S+$EntityValue$S*>/gs)
  {
    $result{$1} = $2 || $3;
    $result{$1} =~ s/&apos;/'/g;
  }

  # Remove entities
  $data =~ s/<!ENTITY$S+$Name$S+$EntityValue$S*>//gs;

  # Remove spaces
  $data =~ s/^\s+//gs;
  $data =~ s/\s+$//gs;
  $data =~ s/\s+/ /gs;

  print "Unrecognized data in file '$file': $data\n" if $data ne '';

  return \%result;
}

sub parsePropertiesFile
{
  my $file = shift;

  my %result = ();

  my $data = readFile($file);
  while ($data =~ /^(.*)$/mg)
  {
    my $line = $1;

    # ignore comments
    next if $line =~ /^\s*[#!]/;

    if ($line =~ /=/)
    {
      my ($key, $value) = split(/=/, $line, 2);
      $result{$key} = $value;
    }
    elsif ($line =~ /\S/)
    {
      print "Unrecognized data in file '$file': $line\n";
    }
  }
  close(FILE);

  return \%result;
}

sub readLocaleFiles
{
  my $locale = shift;

  my %result = ();
  foreach my $dir (keys %paths)
  {
    opendir(local *DIR, "$paths{$dir}/$locale") or next;
    foreach my $file (readdir(DIR))
    {
      if ($file =~ /(.*)\.dtd$/)
      {
        $result{"$dir:$1"} = parseDTDFile("$paths{$dir}/$locale/$file");
      }
      elsif ($file =~ /(.*)\.properties$/)
      {
        $result{"$dir:$1"} = parsePropertiesFile("$paths{$dir}/$locale/$file");
      }
    }
    closedir(DIR);
  }

  return \%result;
}

sub compareLocales
{
  my ($locale, $current, $reference) = @_;

  my %hasFile = ();
  foreach my $file (keys %$current)
  {
    unless (exists($reference->{$file}))
    {
      print "$locale: Extra file '$file'\n";
      next;
    }
    $hasFile{$file} = 1;

    my %hasValue = ();
    foreach my $key (keys %{$current->{$file}})
    {
      unless (exists($reference->{$file}{$key}))
      {
        print "$locale: Extra value '$file:$key'\n";
        next;
      }
      $hasValue{$key} = 1;
    }

    foreach my $key (keys %{$reference->{$file}})
    {
      unless (exists($current->{$file}{$key}))
      {
        print "$locale: Missing value '$file:$key'\n";
        next;
      }
    }
  }

  foreach my $file (keys %$reference)
  {
    unless (exists($current->{$file}))
    {
      print "$locale: Missing file '$file'\n";
      next;
    }
  }
}
