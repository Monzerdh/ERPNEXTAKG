from setuptools import setup, find_packages

with open("requirements.txt") as f:
    install_requires = f.read().strip().split("\n")

setup(
    name="akg_ess",
    version="0.0.1",
    description="Employee Self-Service PWA for AKG Contracting (attendance, leaves, petty cash).",
    author="AKG Contracting",
    author_email="it@akg.ae",
    packages=find_packages(),
    zip_safe=False,
    include_package_data=True,
    install_requires=install_requires,
)
