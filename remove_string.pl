#!/usr/bin/perl -w

use strict;

my ($file, $string) = @ARGV;

opendir(local *DIR, "chrome/locale") or die "Could not open directory chrome/locale";
my @locales = sort {$a cmp $b} grep {!/[^\w\-]/} readdir(DIR);
closedir(DIR);

foreach my $locale (@locales) {
  open(local *FILE, "chrome/locale/$locale/$file") or ((warn "Could not open file chrome/locale/$locale/$file") && next);
  binmode(FILE);
  local $/;
  my $data = <FILE>;
  close(FILE);

  if ($file =~ /\.dtd$/) {
    $data =~ s/<!ENTITY\s+$string\s+"[^"]*">\s*//gs or ((warn "String $string not found in file chrome/locale/$locale/$file") && next);
  }
  else {
    $data =~ s/^$string=.*\n//gm or (warn "String $string not found in file chrome/locale/$locale/$file" && next);
  }

  open(FILE, ">chrome/locale/$locale/$file") or die "Could not write file chrome/locale/$locale/$file";
  binmode(FILE);
  print FILE $data;
  close(FILE);
}
