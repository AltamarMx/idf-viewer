# Example gallery

Every `.idf` and `.epJSON` file in this folder appears on the viewer's start page.

To add one, copy the file here and push to `main`. The site is rebuilt and the
file shows up in the gallery, sorted by size.

`examples.json` is optional. Use it to give a file a title and a short description:

```json
{
  "MyHouse.idf": { "title": "My house", "description": "Two-storey house with AirflowNetwork" }
}
```

The files from the EnergyPlus distribution keep their license: see
`LICENSE-EnergyPlus.txt`.
