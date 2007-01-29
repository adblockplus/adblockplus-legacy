#!/usr/bin/perl

use strict;

my ($file, $string) = @ARGV;

opendir(local *DIR, "chrome/locale") or die "Could not open directory chrome/locale";
my @locales = sort {$a cmp $b} grep {!/[^\w\-]/ && !/CVS/} readdir(DIR);
closedir(DIR);

foreach my $locale (@locales) {
  open(local *FILE, "chrome/locale/$locale/$file") or die "Could not open file chrome/locale/$locale/$file";
  local $/;
  my $data = <FILE>;
  close(FILE);

  if ($file =~ /\.dtd$/) {
    $data =~ s/<!ENTITY\s+$string\s+"[^"]*">\s*//gs or die "String $string not found in file chrome/locale/$locale/$file";
  }
  else {
    $data =~ s/^$string=.*\n//gm or die "String $string not found in file chrome/locale/$locale/$file";
  }

  open(FILE, ">chrome/locale/$locale/$file") or die "Could not write file chrome/locale/$locale/$file";
  print FILE $data;
  close(FILE);
}
